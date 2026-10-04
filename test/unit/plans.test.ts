/**
 * Unit: plan file location, slug generation, and file reads and writes.
 *
 * The slug rules mirror Claude Code v2.1.88: three words, retry on collision,
 * and the last candidate is reused when every attempt collides. The word lists
 * are shipped data, so their only testable properties are non-emptiness and
 * uniqueness.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	generateSlug,
	getPlanFilePath,
	getPlansDirectory,
	MAX_SLUG_ATTEMPTS,
	readPlan,
	writePlan,
} from "../../src/plans.ts";
import { ADJECTIVES, NOUNS, VERBS } from "../../src/words.ts";

test("the plans directory lives under PI_CODING_AGENT_DIR", () => {
	const env = { PI_CODING_AGENT_DIR: "/tmp/agent" } as NodeJS.ProcessEnv;
	assert.equal(getPlansDirectory(env), join("/tmp/agent", "plans"));
});

test("the plans directory falls back to ~/.pi/agent", () => {
	assert.equal(getPlansDirectory({} as NodeJS.ProcessEnv), join(homedir(), ".pi", "agent", "plans"));
});

test("word lists are not empty and contain no duplicate", () => {
	for (const [name, list] of [
		["ADJECTIVES", ADJECTIVES],
		["VERBS", VERBS],
		["NOUNS", NOUNS],
	] as const) {
		assert.ok(list.length > 0, `${name} must not be empty`);
		assert.equal(new Set(list).size, list.length, `${name} must not repeat a word`);
	}
});

test("a slug is an adjective, a verb, and a noun from the lists", () => {
	const slug = generateSlug(
		() => false,
		() => 0,
	);
	const parts = slug.split("-");
	assert.equal(parts.length, 3, "a slug has three words");
	const [adjective = "", verb = "", noun = ""] = parts;
	assert.ok(ADJECTIVES.includes(adjective), `${adjective} must come from ADJECTIVES`);
	assert.ok(VERBS.includes(verb), `${verb} must come from VERBS`);
	assert.ok(NOUNS.includes(noun), `${noun} must come from NOUNS`);
});

test("a slug stops at the first candidate that does not exist", () => {
	let calls = 0;
	const exists = () => {
		calls++;
		return calls < 3;
	};
	const slug = generateSlug(exists, () => 0);
	const expected = `${ADJECTIVES[0] ?? ""}-${VERBS[0] ?? ""}-${NOUNS[0] ?? ""}`;
	assert.equal(slug, expected);
	assert.equal(calls, 3, "the loop must stop as soon as a free slug is found");
});

test("a slug reuses the last candidate when every attempt collides", () => {
	let calls = 0;
	const exists = () => {
		calls++;
		return true;
	};
	const slug = generateSlug(exists, () => 0);
	const expected = `${ADJECTIVES[0] ?? ""}-${VERBS[0] ?? ""}-${NOUNS[0] ?? ""}`;
	assert.equal(slug, expected);
	assert.equal(calls, MAX_SLUG_ATTEMPTS, "the loop must give up after the documented attempts");
});

test("writePlan creates the directory and readPlan returns the content", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-plan-plans-"));
	try {
		const path = getPlanFilePath(join(dir, "plans"), "bright-brewing-phoenix");
		assert.equal(readPlan(path), undefined, "a missing plan file reads as undefined");
		writePlan(path, "# Plan\n");
		assert.equal(readPlan(path), "# Plan\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
