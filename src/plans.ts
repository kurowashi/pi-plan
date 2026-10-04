/**
 * Plan files: where they live, how their slugs are generated, and how they are
 * read and written. The plan file is the only source of truth for the plan
 * body, so nothing here touches session state.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ADJECTIVES, NOUNS, VERBS } from "./words.ts";

/** Claude Code gives up after ten collisions and reuses the last candidate. */
export const MAX_SLUG_ATTEMPTS = 10;

/** Plan files live next to the other Pi agent state. */
export function getPlansDirectory(env: NodeJS.ProcessEnv = process.env): string {
	const agentDirectory = env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
	return join(agentDirectory, "plans");
}

export function getPlanFilePath(plansDirectory: string, slug: string): string {
	return join(plansDirectory, `${slug}.md`);
}

function pick(words: readonly string[], random: () => number): string {
	const index = Math.floor(random() * words.length);
	return words[index] ?? words[0] ?? "";
}

/**
 * A slug is `adjective-verb-noun`, retried while the caller reports a collision.
 * When every attempt collides, the last candidate is reused, as in Claude Code.
 */
export function generateSlug(exists: (slug: string) => boolean, random: () => number = Math.random): string {
	let slug = "";
	for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
		slug = `${pick(ADJECTIVES, random)}-${pick(VERBS, random)}-${pick(NOUNS, random)}`;
		if (!exists(slug)) return slug;
	}
	return slug;
}

export function readPlan(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		// A missing or unreadable plan file is the same to the caller: no plan yet.
		return undefined;
	}
}

export function writePlan(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}
