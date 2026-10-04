/**
 * Plan mode state and the injection decision.
 *
 * The session branch is the source of truth. The `plan-mode` entry carries the
 * mode and the two one-shot notices; the injected context and exit entries
 * carry the throttle and the full/sparse cycle, so the counter survives resume
 * and compaction without separate storage.
 */

/** Session entry for the mode snapshot (not sent to the model). */
export const PLAN_MODE_ENTRY_TYPE = "plan-mode";

/** Injected reminder (sent to the model, hidden in the transcript). */
export const CONTEXT_ENTRY_TYPE = "plan-mode-context";

/** One-shot "you have exited" notice (sent to the model, hidden in the transcript). */
export const EXIT_NOTICE_TYPE = "plan-mode-exit";

/** Injects a reminder every five human turns, as Claude Code does. */
export const TURNS_BETWEEN_INJECTIONS = 5;

/** Every fifth reminder repeats the full instructions, as Claude Code does. */
export const FULL_EVERY_N_INJECTIONS = 5;

/** The persisted mode state. */
export interface PlanModeSnapshot {
	active: boolean;
	/** The exit notice has not been sent yet. */
	exitNoticePending: boolean;
	/** The reentry notice has not been sent yet. */
	reentryPending: boolean;
	slug?: string;
}

/** The subset of a session entry this module reads. */
export interface BranchEntry {
	type: string;
	customType?: string;
	message?: { role?: string };
	data?: unknown;
}

export type InjectionDecision =
	| { kind: "none" }
	| { kind: "exit" }
	| { kind: "context"; reminder: "full" | "sparse"; reentry: boolean };

export function readSnapshot(branch: readonly BranchEntry[]): PlanModeSnapshot | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type !== "custom" || entry.customType !== PLAN_MODE_ENTRY_TYPE) continue;
		return parseSnapshot(entry.data);
	}
	return undefined;
}

function parseSnapshot(data: unknown): PlanModeSnapshot | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const record = data as Record<string, unknown>;
	const active = record["active"];
	if (typeof active !== "boolean") return undefined;
	const slug = record["slug"];
	return {
		active,
		exitNoticePending: record["exitNoticePending"] === true,
		reentryPending: record["reentryPending"] === true,
		...(typeof slug === "string" && slug !== "" ? { slug } : {}),
	};
}

/**
 * The exit notice and a compaction both end the current injection cycle: the
 * reminders before them are no longer in context, so counting starts fresh.
 */
function isBoundary(entry: BranchEntry): boolean {
	if (entry.type === "compaction") return true;
	return entry.type === "custom_message" && entry.customType === EXIT_NOTICE_TYPE;
}

function isContextEntry(entry: BranchEntry): boolean {
	return entry.type === "custom_message" && entry.customType === CONTEXT_ENTRY_TYPE;
}

function isHumanTurn(entry: BranchEntry): boolean {
	return entry.type === "message" && entry.message?.role === "user";
}

interface InjectionCycle {
	humanTurnsSinceReminder: number;
	remindersSinceBoundary: number;
	foundReminder: boolean;
}

/**
 * Walk back to the boundary (a compaction or the exit notice). Human turns stop
 * at the most recent reminder; reminders keep counting so the full/sparse cycle
 * can be derived.
 */
function scanCycle(branch: readonly BranchEntry[]): InjectionCycle {
	const cycle: InjectionCycle = { humanTurnsSinceReminder: 0, remindersSinceBoundary: 0, foundReminder: false };
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry === undefined || isBoundary(entry)) break;
		if (isContextEntry(entry)) {
			cycle.foundReminder = true;
			cycle.remindersSinceBoundary++;
			continue;
		}
		if (!cycle.foundReminder && isHumanTurn(entry)) cycle.humanTurnsSinceReminder++;
	}
	return cycle;
}

export function decideInjection(
	branch: readonly BranchEntry[],
	snapshot: PlanModeSnapshot | undefined,
	planExists: boolean,
): InjectionDecision {
	if (snapshot === undefined || !snapshot.active) {
		return snapshot?.exitNoticePending === true ? { kind: "exit" } : { kind: "none" };
	}

	const cycle = scanCycle(branch);
	// The current user turn is not in the branch yet, so it counts here.
	if (cycle.foundReminder && cycle.humanTurnsSinceReminder + 1 < TURNS_BETWEEN_INJECTIONS) {
		return { kind: "none" };
	}

	const reminder = (cycle.remindersSinceBoundary + 1) % FULL_EVERY_N_INJECTIONS === 1 ? "full" : "sparse";
	return { kind: "context", reminder, reentry: snapshot.reentryPending && planExists };
}
