/**
 * Integration: the command, shortcut, tools, and event flow over a fake session.
 *
 * The extension is invoked exactly as Pi invokes it: registrations are captured
 * and the documented events are emitted. The fake session branch stands in for
 * the session manager, and `appendEntry` grows it the way Pi grows the real one.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import planExtension from "../../src/index.ts";
import {
	type BranchEntry,
	CONTEXT_ENTRY_TYPE,
	EXIT_NOTICE_TYPE,
	PLAN_MODE_ENTRY_TYPE,
	type PlanModeSnapshot,
} from "../../src/state.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type CommandHandler = (args: string, ctx: ExtensionContext) => unknown;
type ShortcutHandler = (ctx: ExtensionContext) => unknown;

interface ToolResultLike {
	content: Array<{ type: string; text?: string }>;
}

interface ToolLike {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	) => Promise<ToolResultLike>;
}

interface InjectedMessage {
	customType?: string;
	content?: unknown;
	display?: boolean;
}

interface Harness {
	branch: BranchEntry[];
	ctx: ExtensionContext;
	statuses: (string | undefined)[];
	notifications: string[];
	sent: string[];
	choices: (string | undefined)[];
	inputs: (string | undefined)[];
	editors: (string | undefined)[];
	start(reason?: string): void;
	prompt(): InjectedMessage | undefined;
	command(args: string): Promise<void>;
	shortcut(): Promise<void>;
	tool(name: string): ToolLike;
	entry(): PlanModeSnapshot | undefined;
	planPath(): string;
	writePlanBody(body: string): void;
	cleanup(): void;
}

function createHarness(options: { hasUI?: boolean; planFlag?: boolean } = {}): Harness {
	const directory = mkdtempSync(join(tmpdir(), "pi-plan-integration-"));
	process.env["PI_CODING_AGENT_DIR"] = directory;

	const branch: BranchEntry[] = [];
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, CommandHandler>();
	const shortcuts: ShortcutHandler[] = [];
	const tools = new Map<string, ToolLike>();
	const statuses: (string | undefined)[] = [];
	const notifications: string[] = [];
	const sent: string[] = [];
	const choices: (string | undefined)[] = [];
	const inputs: (string | undefined)[] = [];
	const editors: (string | undefined)[] = [];

	const api = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerTool(tool: ToolLike) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: { handler: CommandHandler }) {
			commands.set(name, command.handler);
		},
		registerShortcut(_key: string, shortcut: { handler: ShortcutHandler }) {
			shortcuts.push(shortcut.handler);
		},
		registerFlag() {},
		getFlag(name: string) {
			return name === "plan" ? options.planFlag === true : undefined;
		},
		appendEntry(customType: string, data?: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		sendUserMessage(content: string) {
			sent.push(content);
		},
	} as unknown as ExtensionAPI;

	const ctx = {
		cwd: directory,
		hasUI: options.hasUI ?? true,
		isProjectTrusted: () => true,
		ui: {
			select: async () => choices.shift(),
			input: async () => inputs.shift(),
			editor: async () => editors.shift(),
			notify: (message: string) => {
				notifications.push(message);
			},
			setStatus: (_key: string, text: string | undefined) => {
				statuses.push(text);
			},
		},
		sessionManager: { getBranch: () => branch },
	} as unknown as ExtensionContext;

	planExtension(api);

	const harness: Harness = {
		branch,
		ctx,
		statuses,
		notifications,
		sent,
		choices,
		inputs,
		editors,
		start(reason = "startup") {
			emit("session_start", { type: "session_start", reason });
		},
		prompt() {
			const result = emit("before_agent_start", { type: "before_agent_start" }) as
				| { message?: InjectedMessage }
				| undefined;
			const message = result?.message;
			if (message !== undefined) {
				branch.push({
					type: "custom_message",
					...(message.customType === undefined ? {} : { customType: message.customType }),
					data: message.content,
				});
			}
			return message;
		},
		async command(args: string) {
			const handler = commands.get("plan");
			if (handler === undefined) throw new Error("the /plan command is not registered");
			await Promise.resolve(handler(args, ctx));
		},
		async shortcut() {
			const handler = shortcuts[0];
			if (handler === undefined) throw new Error("the Ctrl+Alt+P shortcut is not registered");
			await Promise.resolve(handler(ctx));
		},
		tool(name: string) {
			const tool = tools.get(name);
			if (tool === undefined) throw new Error(`${name} is not registered`);
			return tool;
		},
		entry() {
			for (let index = branch.length - 1; index >= 0; index--) {
				const entry = branch[index];
				if (entry?.type === "custom" && entry.customType === PLAN_MODE_ENTRY_TYPE) {
					return entry.data as PlanModeSnapshot;
				}
			}
			return undefined;
		},
		planPath() {
			const slug = harness.entry()?.slug ?? "";
			return join(directory, "plans", `${slug}.md`);
		},
		writePlanBody(body: string) {
			mkdirSync(join(directory, "plans"), { recursive: true });
			writeFileSync(harness.planPath(), body);
		},
		cleanup() {
			delete process.env["PI_CODING_AGENT_DIR"];
			rmSync(directory, { recursive: true, force: true });
		},
	};
	return harness;

	function emit(event: string, data: unknown): unknown {
		let result: unknown;
		for (const handler of handlers.get(event) ?? []) result = handler(data, ctx) ?? result;
		return result;
	}
}

async function callTool(harness: Harness, name: string): Promise<string> {
	const result = await harness.tool(name).execute("test-call", {}, undefined, undefined, harness.ctx);
	return result.content.map((part) => part.text ?? "").join("");
}

function user(branch: BranchEntry[]): void {
	branch.push({ type: "message", message: { role: "user" } });
}

const LAST_STATUS = (harness: Harness): string | undefined => harness.statuses[harness.statuses.length - 1];

test("enters plan mode from /plan and shows the status", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	assert.equal(harness.entry()?.active, true);
	assert.ok(harness.entry()?.slug);
	assert.equal(LAST_STATUS(harness), "⏸ plan mode on");
});

test("/plan with a task enters plan mode and sends the task", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("refactor the auth module");
	assert.equal(harness.entry()?.active, true);
	assert.deepEqual(harness.sent, ["refactor the auth module"]);
});

test("/plan while planning shows the plan and the path without leaving plan mode", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	harness.writePlanBody("# My plan\n");
	await harness.command("");
	assert.equal(harness.entry()?.active, true);
	assert.deepEqual(harness.sent, []);
	assert.ok(harness.notifications[0]?.includes(harness.planPath()), "the notification must name the plan file");
	assert.ok(harness.notifications[0]?.includes("# My plan"));
});

test("Ctrl+Alt+P toggles plan mode and clears the status", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.shortcut();
	assert.equal(harness.entry()?.active, true);
	assert.equal(LAST_STATUS(harness), "⏸ plan mode on");
	await harness.shortcut();
	assert.equal(harness.entry()?.active, false);
	assert.equal(LAST_STATUS(harness), undefined);
});

test("--plan starts the session in plan mode", (t) => {
	const harness = createHarness({ planFlag: true });
	t.after(() => harness.cleanup());
	harness.start();
	assert.equal(harness.entry()?.active, true);
	assert.equal(LAST_STATUS(harness), "⏸ plan mode on");
});

test("enter_plan_mode asks for consent and enters on agreement", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	harness.choices.push("Yes, enter plan mode");
	const text = await callTool(harness, "enter_plan_mode");
	assert.equal(harness.entry()?.active, true);
	assert.ok(text.includes("Entered plan mode"));
});

test("enter_plan_mode keeps the mode off when the user declines", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	harness.choices.push("No, start implementing now");
	const text = await callTool(harness, "enter_plan_mode");
	assert.equal(harness.entry(), undefined);
	assert.ok(text.includes("declined"));
});

test("enter_plan_mode reports the missing dialog without entering", async (t) => {
	const harness = createHarness({ hasUI: false });
	t.after(() => harness.cleanup());
	harness.start();
	const text = await callTool(harness, "enter_plan_mode");
	assert.equal(harness.entry(), undefined);
	assert.ok(text.includes("no dialog-capable UI"));
});

test("enter_plan_mode reports that plan mode is already active", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	const text = await callTool(harness, "enter_plan_mode");
	assert.equal(harness.entry()?.active, true);
	assert.ok(text.includes("Already in plan mode"));
});

test("exit_plan_mode outside plan mode does not change the mode", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	const text = await callTool(harness, "exit_plan_mode");
	assert.equal(harness.entry(), undefined);
	assert.ok(text.includes("You are not in plan mode"));
});

test("approving the plan echoes the plan file and leaves plan mode", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	harness.writePlanBody("# My plan\n\nStep 1\n");
	harness.choices.push("Yes, execute the plan");
	const text = await callTool(harness, "exit_plan_mode");
	assert.equal(harness.entry()?.active, false);
	assert.equal(harness.entry()?.exitNoticePending, true);
	assert.equal(LAST_STATUS(harness), undefined);
	assert.ok(text.includes("User has approved your plan"));
	assert.ok(text.includes("# My plan"));
	assert.ok(text.includes(harness.planPath()));
});

test("editing the plan before approval writes it back and labels the result", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	harness.writePlanBody("# Draft\n");
	harness.choices.push("Edit the plan, then execute");
	harness.editors.push("# Edited\n");
	const text = await callTool(harness, "exit_plan_mode");
	assert.equal(readFileSync(harness.planPath(), "utf8"), "# Edited\n");
	assert.ok(text.includes("edited by user"));
	assert.ok(text.includes("# Edited"));
});

test("keeping the plan returns the feedback and stays in plan mode", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	harness.choices.push("No, keep planning");
	harness.inputs.push("add a verification section");
	const text = await callTool(harness, "exit_plan_mode");
	assert.equal(harness.entry()?.active, true);
	assert.ok(text.includes("add a verification section"));
});

test("exit_plan_mode refuses to approve without a dialog-capable UI", async (t) => {
	const harness = createHarness({ hasUI: false });
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	const text = await callTool(harness, "exit_plan_mode");
	assert.equal(harness.entry()?.active, true);
	assert.ok(text.includes("no dialog-capable UI"));
});

test("a missing plan file approves as an empty plan", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	harness.choices.push("Yes, execute the plan");
	const text = await callTool(harness, "exit_plan_mode");
	assert.equal(harness.entry()?.active, false);
	assert.ok(text.includes("User has approved exiting plan mode"));
});

test("the first plan mode turn injects the full instructions", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	const message = harness.prompt();
	assert.equal(message?.customType, CONTEXT_ENTRY_TYPE);
	assert.equal(message?.display, false);
	assert.ok(String(message?.content).includes("Plan mode is active"));
});

test("reminders arrive every five human turns and stay sparse", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	harness.prompt();
	for (let turn = 0; turn < 3; turn++) user(harness.branch);
	assert.equal(harness.prompt(), undefined, "three turns are below the throttle");
	user(harness.branch);
	const message = harness.prompt();
	assert.equal(message?.customType, CONTEXT_ENTRY_TYPE);
	assert.ok(String(message?.content).includes("Plan mode still active"));
});

test("compaction makes the next turn inject the full instructions again", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	harness.prompt();
	harness.branch.push({ type: "compaction" });
	const message = harness.prompt();
	assert.ok(String(message?.content).includes("Plan mode is active"));
});

test("reentering plan mode injects the reentry notice once", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	harness.writePlanBody("# My plan\n");
	harness.choices.push("Yes, execute the plan");
	await callTool(harness, "exit_plan_mode");
	harness.prompt(); // the exit notice
	await harness.shortcut();
	const message = harness.prompt();
	assert.ok(String(message?.content).includes("## Re-entering Plan Mode"));
	assert.equal(harness.entry()?.reentryPending, false);
	assert.equal(harness.prompt(), undefined, "the reentry notice is sent once");
});

test("exiting plan mode injects the exit notice once", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	await harness.shortcut();
	const message = harness.prompt();
	assert.equal(message?.customType, EXIT_NOTICE_TYPE);
	assert.ok(String(message?.content).startsWith("## Exited Plan Mode"));
	assert.equal(harness.prompt(), undefined, "the exit notice is sent once");
});

test("session start restores the mode and the reminder counter from the branch", (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.branch.push(
		{
			type: "custom",
			customType: PLAN_MODE_ENTRY_TYPE,
			data: { active: true, exitNoticePending: false, reentryPending: false, slug: "bright-brewing-phoenix" },
		},
		{ type: "custom_message", customType: CONTEXT_ENTRY_TYPE },
	);
	for (let turn = 0; turn < 3; turn++) user(harness.branch);
	harness.start("resume");
	assert.equal(LAST_STATUS(harness), "⏸ plan mode on");
	assert.equal(harness.prompt(), undefined, "the restored counter still throttles");
	user(harness.branch);
	assert.ok(String(harness.prompt()?.content).includes("Plan mode still active"));
});

test("session start generates a slug when the restored snapshot has none", (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.branch.push({ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { active: true, slug: "" } });
	harness.start("resume");
	assert.ok(harness.entry()?.slug);
});

test("fork regenerates the plan slug", (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.branch.push({
		type: "custom",
		customType: PLAN_MODE_ENTRY_TYPE,
		data: { active: true, exitNoticePending: false, reentryPending: false, slug: "ancient-brewing-phoenix" },
	});
	harness.start("fork");
	assert.equal(harness.entry()?.active, true);
	assert.notEqual(harness.entry()?.slug, "ancient-brewing-phoenix");
	assert.equal(LAST_STATUS(harness), "⏸ plan mode on");
});

function countSnapshotEntries(branch: BranchEntry[]): number {
	return branch.filter((entry) => entry.type === "custom" && entry.customType === PLAN_MODE_ENTRY_TYPE).length;
}

test("session start restores a pending exit notice and sends it once", (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.branch.push({
		type: "custom",
		customType: PLAN_MODE_ENTRY_TYPE,
		data: { active: false, exitNoticePending: true, reentryPending: true, slug: "bright-brewing-phoenix" },
	});
	harness.start("resume");
	const message = harness.prompt();
	assert.equal(message?.customType, EXIT_NOTICE_TYPE);
	assert.equal(harness.entry()?.exitNoticePending, false);
	assert.equal(harness.prompt(), undefined, "the exit notice is sent once");
});

test("/plan with a task while planning queues the task without changing the mode", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.start();
	await harness.command("");
	const entriesBefore = countSnapshotEntries(harness.branch);
	await harness.command("add a verification section");
	assert.deepEqual(harness.sent, ["add a verification section"]);
	assert.equal(harness.entry()?.active, true);
	assert.equal(countSnapshotEntries(harness.branch), entriesBefore, "queueing a task must not rewrite the mode");
});

test("fork keeps the slug when plan mode is not active", (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	harness.branch.push({
		type: "custom",
		customType: PLAN_MODE_ENTRY_TYPE,
		data: { active: false, exitNoticePending: false, reentryPending: false, slug: "ancient-brewing-phoenix" },
	});
	harness.start("fork");
	assert.equal(harness.entry()?.slug, "ancient-brewing-phoenix");
	assert.equal(LAST_STATUS(harness), undefined);
});
