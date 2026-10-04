/**
 * Loads the real extension entry through Pi's own loader (jiti), the same path
 * Pi uses at runtime. Contract tests therefore validate the shipped artifact,
 * not a re-import of the modules under test.
 *
 * The loader also scans project and global extension directories, so both are
 * redirected to an empty temporary directory to keep the test hermetic.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAndLoadExtensions, type Extension } from "@earendil-works/pi-coding-agent";
import { PACKAGE_ROOT } from "./root.ts";

/** The path declared in package.json under `pi.extensions`. */
export const EXTENSION_ENTRY = join(PACKAGE_ROOT, "src", "index.ts");

/** Empty sandbox standing in for a project root and a Pi agent directory. */
const SANDBOX = mkdtempSync(join(tmpdir(), "pi-plan-contract-"));

/** Load the extension exactly as Pi does, failing loudly on loader errors. */
export async function loadPlanExtension(): Promise<Extension> {
	const result = await discoverAndLoadExtensions([EXTENSION_ENTRY], SANDBOX, SANDBOX);
	assert.deepEqual(result.errors, [], "extension must load without errors");
	assert.equal(result.extensions.length, 1, "the sandbox must load only this extension");
	const extension = result.extensions[0];
	assert.ok(extension, "loader must return one extension");
	return extension;
}
