/**
 * pi-plan: Claude Code's plan mode for Pi.
 *
 * Read-only is a prompt-level instruction, not a hook (ADR 0001). Every mode
 * transition appends a `plan-mode` entry, and the injection decision re-derives
 * the throttle from the injected entries, so resume and compaction need no
 * separate counter state.
 */

import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateSlug, getPlanFilePath, getPlansDirectory, readPlan } from "./plans.ts";
import {
	buildExitInstructions,
	buildFullInstructions,
	buildReentryInstructions,
	buildSparseInstructions,
} from "./prompts.ts";
import {
	CONTEXT_ENTRY_TYPE,
	decideInjection,
	EXIT_NOTICE_TYPE,
	PLAN_MODE_ENTRY_TYPE,
	type PlanModeSnapshot,
	readSnapshot,
} from "./state.ts";
import { createPlanModeTools } from "./tools.ts";

const STATUS_KEY = "plan-mode";
const STATUS_TEXT = "⏸ plan mode on";

export default function planExtension(pi: ExtensionAPI): void {
	const plansDirectory = getPlansDirectory();
	let snapshot: PlanModeSnapshot | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(STATUS_KEY, snapshot?.active === true ? STATUS_TEXT : undefined);
	}

	function persist(next: PlanModeSnapshot, ctx: ExtensionContext): void {
		snapshot = next;
		pi.appendEntry(PLAN_MODE_ENTRY_TYPE, next);
		updateStatus(ctx);
	}

	function planFilePath(): string {
		return getPlanFilePath(plansDirectory, snapshot?.slug ?? "");
	}

	/** Fork must not reuse the parent slug, so the old one is excluded explicitly. */
	function nextSlug(exclude?: string): string {
		return generateSlug((candidate) => candidate === exclude || existsSync(getPlanFilePath(plansDirectory, candidate)));
	}

	function enterPlanMode(ctx: ExtensionContext): void {
		const previous = snapshot;
		persist(
			{
				active: true,
				exitNoticePending: false,
				// Re-entering before the reentry notice went out keeps it pending.
				reentryPending: previous?.reentryPending === true,
				slug: previous?.slug ?? nextSlug(),
			},
			ctx,
		);
	}

	function exitPlanMode(ctx: ExtensionContext): void {
		if (snapshot?.active !== true) return;
		persist({ ...snapshot, active: false, exitNoticePending: true, reentryPending: true }, ctx);
	}

	const [enterTool, exitTool] = createPlanModeTools({
		snapshot: () => snapshot,
		planFilePath,
		enter: enterPlanMode,
		exit: exitPlanMode,
	});
	pi.registerTool(enterTool);
	pi.registerTool(exitTool);

	pi.registerCommand("plan", {
		description: "Enter plan mode, or show the current plan while planning",
		async handler(args, ctx) {
			const task = args.trim();
			if (snapshot?.active === true) {
				if (task === "") {
					const body = readPlan(planFilePath());
					ctx.ui.notify(body === undefined ? `No plan file yet at ${planFilePath()}` : `${planFilePath()}\n\n${body}`);
					return;
				}
				pi.sendUserMessage(task);
				return;
			}
			enterPlanMode(ctx);
			if (task !== "") pi.sendUserMessage(task);
		},
	});

	pi.registerShortcut("ctrl+alt+p", {
		description: "Toggle plan mode",
		handler(ctx) {
			if (snapshot?.active === true) exitPlanMode(ctx);
			else enterPlanMode(ctx);
		},
	});

	pi.registerFlag("plan", { type: "boolean", description: "Start the session in plan mode" });

	pi.on("session_start", (event, ctx) => {
		const restored = readSnapshot(ctx.sessionManager.getBranch());
		if (restored === undefined) {
			snapshot = undefined;
			if (pi.getFlag("plan") === true) enterPlanMode(ctx);
			else updateStatus(ctx);
			return;
		}
		snapshot = restored;
		if (restored.active) {
			if (restored.slug === undefined) persist({ ...restored, slug: nextSlug() }, ctx);
			else if (event.reason === "fork") persist({ ...restored, slug: nextSlug(restored.slug) }, ctx);
		}
		updateStatus(ctx);
	});

	function exitNotice(ctx: ExtensionContext, current: PlanModeSnapshot, path: string, planExists: boolean) {
		persist({ ...current, exitNoticePending: false }, ctx);
		return {
			message: {
				customType: EXIT_NOTICE_TYPE,
				content: buildExitInstructions(planExists ? path : undefined),
				display: false,
			},
		};
	}

	function contextNotice(
		ctx: ExtensionContext,
		current: PlanModeSnapshot,
		decision: { reminder: "full" | "sparse"; reentry: boolean },
		path: string,
		planExists: boolean,
	) {
		if (decision.reentry) persist({ ...current, reentryPending: false }, ctx);
		const body = decision.reminder === "full" ? buildFullInstructions(path, planExists) : buildSparseInstructions(path);
		const content = decision.reentry ? `${buildReentryInstructions(path)}\n\n${body}` : body;
		return { message: { customType: CONTEXT_ENTRY_TYPE, content, display: false } };
	}

	pi.on("before_agent_start", (_event, ctx) => {
		if (snapshot === undefined) return;
		const current = snapshot;
		const path = planFilePath();
		const planExists = existsSync(path);
		const decision = decideInjection(ctx.sessionManager.getBranch(), current, planExists);
		if (decision.kind === "none") return;
		if (decision.kind === "exit") return exitNotice(ctx, current, path, planExists);
		return contextNotice(ctx, current, decision, path, planExists);
	});
}
