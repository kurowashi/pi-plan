/**
 * Unit: restoring the mode from the session branch and deciding the injection.
 *
 * The session branch is the only source of truth: the snapshot entry carries
 * the mode, and the injected context entries carry the throttle and the
 * full/sparse cycle. Nothing about the counter is stored separately.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
	type BranchEntry,
	CONTEXT_ENTRY_TYPE,
	decideInjection,
	EXIT_NOTICE_TYPE,
	PLAN_MODE_ENTRY_TYPE,
	type PlanModeSnapshot,
	readSnapshot,
} from "../../src/state.ts";

const SLUG = "bright-brewing-phoenix";

const ACTIVE: PlanModeSnapshot = { active: true, exitNoticePending: false, reentryPending: false, slug: SLUG };
const EXITED: PlanModeSnapshot = { active: false, exitNoticePending: true, reentryPending: true, slug: SLUG };

function snapshotEntry(data: unknown): BranchEntry {
	return { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data };
}

function user(): BranchEntry {
	return { type: "message", message: { role: "user" } };
}

function toolResult(): BranchEntry {
	return { type: "message", message: { role: "toolResult" } };
}

function contextEntry(): BranchEntry {
	return { type: "custom_message", customType: CONTEXT_ENTRY_TYPE };
}

function contextEntries(count: number): BranchEntry[] {
	return Array.from({ length: count }, contextEntry);
}

function exitNotice(): BranchEntry {
	return { type: "custom_message", customType: EXIT_NOTICE_TYPE };
}

function compaction(): BranchEntry {
	return { type: "compaction" };
}

test("readSnapshot returns the most recent plan mode entry", () => {
	const branch = [snapshotEntry(EXITED), snapshotEntry(ACTIVE)];
	assert.deepEqual(readSnapshot(branch), ACTIVE);
});

test("readSnapshot returns undefined when the data is unusable", () => {
	assert.equal(readSnapshot([]), undefined);
	assert.equal(readSnapshot([snapshotEntry(null)]), undefined);
	assert.equal(readSnapshot([snapshotEntry({})]), undefined);
	assert.equal(readSnapshot([snapshotEntry({ reentryPending: true })]), undefined);
});

test("readSnapshot drops a missing or empty slug", () => {
	assert.deepEqual(readSnapshot([snapshotEntry({ active: true })]), {
		active: true,
		exitNoticePending: false,
		reentryPending: false,
	});
	assert.deepEqual(readSnapshot([snapshotEntry({ active: true, slug: "" })]), {
		active: true,
		exitNoticePending: false,
		reentryPending: false,
	});
});

test("an inactive snapshot injects the exit notice only while it is pending", () => {
	assert.deepEqual(decideInjection([], EXITED, true), { kind: "exit" });
	const sent: PlanModeSnapshot = { ...EXITED, exitNoticePending: false };
	assert.deepEqual(decideInjection([], sent, true), { kind: "none" });
});

test("the first plan mode turn gets the full instructions", () => {
	assert.deepEqual(decideInjection([], ACTIVE, false), { kind: "context", reminder: "full", reentry: false });
});

test("the injection is throttled until five human turns have passed", () => {
	const branch = [contextEntry(), user(), user(), user()];
	assert.deepEqual(decideInjection(branch, ACTIVE, false), { kind: "none" });
	branch.push(user());
	assert.deepEqual(decideInjection(branch, ACTIVE, false), { kind: "context", reminder: "sparse", reentry: false });
});

test("assistant and tool result entries do not advance the counter", () => {
	const branch = [contextEntry(), toolResult(), toolResult(), toolResult(), toolResult(), toolResult()];
	assert.deepEqual(decideInjection(branch, ACTIVE, false), { kind: "none" });
});

test("every fifth injection is full again", () => {
	const branch = [...contextEntries(5), user(), user(), user(), user(), user()];
	assert.deepEqual(decideInjection(branch, ACTIVE, false), { kind: "context", reminder: "full", reentry: false });
});

test("the exit notice resets the throttle and the cycle", () => {
	const branch = [...contextEntries(3), exitNotice(), user(), user(), user(), user()];
	assert.deepEqual(decideInjection(branch, ACTIVE, false), { kind: "context", reminder: "full", reentry: false });
	const after = [...branch, contextEntry(), user(), user(), user()];
	assert.deepEqual(decideInjection(after, ACTIVE, false), { kind: "none" });
	after.push(user());
	assert.deepEqual(decideInjection(after, ACTIVE, false), { kind: "context", reminder: "sparse", reentry: false });
});

test("compaction resets the throttle and the cycle", () => {
	const branch = [...contextEntries(4), compaction()];
	assert.deepEqual(decideInjection(branch, ACTIVE, false), { kind: "context", reminder: "full", reentry: false });
	const after = [...branch, contextEntry(), user(), user(), user()];
	assert.deepEqual(decideInjection(after, ACTIVE, false), { kind: "none" });
	after.push(user());
	assert.deepEqual(decideInjection(after, ACTIVE, false), { kind: "context", reminder: "sparse", reentry: false });
});

test("the reentry notice is only requested when a plan file exists", () => {
	const pending: PlanModeSnapshot = { ...ACTIVE, reentryPending: true };
	assert.deepEqual(decideInjection([], pending, true), { kind: "context", reminder: "full", reentry: true });
	assert.deepEqual(decideInjection([], pending, false), { kind: "context", reminder: "full", reentry: false });
});
