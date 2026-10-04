/**
 * Unit: the injected prompt text.
 *
 * The full instructions are the Claude Code v2.1.88 five-phase workflow with
 * pi's tool names substituted. These tests pin both sides: the phases stay,
 * and no Claude-only tool name leaks into the model's context.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
	buildExitInstructions,
	buildFullInstructions,
	buildReentryInstructions,
	buildSparseInstructions,
} from "../../src/prompts.ts";

const PATH = "/tmp/plans/bright-brewing-phoenix.md";

/** Names that only exist in Claude Code; seeing one means a substitution was missed. */
const CLAUDE_ONLY_NAMES = ["EnterPlanMode", "ExitPlanMode", "AskUserQuestion", "TodoWrite"];

test("full instructions cover the five phases and pi tool names", () => {
	const text = buildFullInstructions(PATH, false);
	for (const phase of ["### Phase 1", "### Phase 2", "### Phase 3", "### Phase 4", "### Phase 5"]) {
		assert.ok(text.includes(phase), `${phase} must appear in the full instructions`);
	}
	assert.ok(text.includes(PATH), "the plan file path must appear");
	assert.ok(text.includes("exit_plan_mode"), "the exit tool must be named");
	assert.ok(text.includes("your question tool"), "the question tool is described without a fixed name");
	assert.ok(text.includes("sub-agent"), "sub-agent exploration is recommended when available");
	assert.ok(text.includes("read-only"), "the read-only rule must be stated");
});

test("full instructions say whether the plan file already exists", () => {
	assert.ok(buildFullInstructions(PATH, false).includes("No plan file exists yet"));
	assert.ok(buildFullInstructions(PATH, true).includes("A plan file already exists"));
});

test("sparse instructions are a single paragraph that points back to the full ones", () => {
	const text = buildSparseInstructions(PATH);
	assert.ok(text.startsWith("Plan mode still active"));
	assert.ok(text.includes(PATH));
	assert.ok(text.includes("exit_plan_mode"));
	assert.ok(text.includes("your question tool"));
	assert.equal(text.split("\n\n").length, 1, "sparse instructions stay one paragraph");
});

test("reentry instructions make the model re-evaluate the existing plan", () => {
	const text = buildReentryInstructions(PATH);
	assert.ok(text.startsWith("## Re-entering Plan Mode"));
	assert.ok(text.includes(PATH));
});

test("exit instructions mention the plan file only when it exists", () => {
	assert.ok(buildExitInstructions(undefined).startsWith("## Exited Plan Mode"));
	assert.equal(buildExitInstructions(undefined).includes(".md"), false);
	assert.ok(buildExitInstructions(PATH).includes(PATH));
});

test("no prompt text carries a Claude-only tool name", () => {
	const sections = [
		buildFullInstructions(PATH, false),
		buildFullInstructions(PATH, true),
		buildSparseInstructions(PATH),
		buildReentryInstructions(PATH),
		buildExitInstructions(PATH),
	];
	for (const text of sections) {
		for (const name of CLAUDE_ONLY_NAMES) {
			assert.equal(text.includes(name), false, `${name} must be substituted before injection`);
		}
	}
});
