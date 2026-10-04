/**
 * Contract: the model-facing surface and the event surface stay fixed.
 *
 * The two tools are the only model-facing registrations: one way into plan mode
 * and one way out. A `tool_call` handler would turn the documented prompt-level
 * read-only instruction into a technical block, which DESIGN.md and ADR 0001
 * deliberately reject. Both are asserted here so the contract changes first.
 *
 * The extension is loaded through Pi's own loader (jiti), the same path Pi uses
 * at runtime, so these assertions cover the shipped artifact rather than a
 * re-import of the modules under test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadPlanExtension } from "../helpers/extension.ts";

/** The documented model-facing tools, one per mode transition. */
const EXPECTED_TOOLS = ["enter_plan_mode", "exit_plan_mode"];

/** The behaviors the README documents, one registration each. */
const EXPECTED_EVENTS = ["before_agent_start", "session_start"];

test("registers exactly the two plan mode tools", async () => {
	const extension = await loadPlanExtension();
	assert.deepEqual([...extension.tools.keys()].sort(), [...EXPECTED_TOOLS].sort());
});

test("registers the /plan command and nothing else", async () => {
	const extension = await loadPlanExtension();
	assert.deepEqual([...extension.commands.keys()], ["plan"]);
});

test("registers the Ctrl+Alt+P shortcut and the --plan flag", async () => {
	const extension = await loadPlanExtension();
	assert.deepEqual([...extension.shortcuts.keys()], ["ctrl+alt+p"]);
	assert.deepEqual([...extension.flags.keys()], ["plan"]);
});

test("every documented event has exactly one handler", async () => {
	const extension = await loadPlanExtension();
	assert.deepEqual([...extension.handlers.keys()].sort(), EXPECTED_EVENTS);
	for (const event of EXPECTED_EVENTS) {
		assert.equal(extension.handlers.get(event)?.length, 1, `${event} must have exactly one handler`);
	}
});

test("registers no tool_call handler", async () => {
	const extension = await loadPlanExtension();
	assert.equal(
		extension.handlers.has("tool_call"),
		false,
		"read-only is a prompt instruction; blocking lives in ADR 0001 as a rejected alternative",
	);
});
