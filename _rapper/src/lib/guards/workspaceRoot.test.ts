import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { workspaceRoot } from "./workspaceRoot";

// A workspace with one tier in place and the same tier as a worktree two
// levels down.
const ROOT = mkdtempSync(join(tmpdir(), "workspace-root-"));
const TIER = join(ROOT, "Tier");
const WORKTREE = join(ROOT, ".wt", "12", "Tier");
writeFileSync(join(ROOT, "package.json"), JSON.stringify({ workspaces: ["Tier"] }));
for (const dir of [TIER, WORKTREE]) {
	mkdirSync(dir, { recursive: true });
	// A tier's own package.json has no `workspaces`, so it must not stop the search.
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "tier" }));
}

describe("workspaceRoot", () => {
	it("finds the workspace above a tier that sits in it", () => {
		expect(workspaceRoot(TIER)).toBe(ROOT);
	});

	it("finds the same workspace from a card worktree two levels down", () => {
		expect(workspaceRoot(WORKTREE)).toBe(ROOT);
	});

	it("takes a file URL, as a vite config hands it import.meta.url", () => {
		expect(workspaceRoot(pathToFileURL(join(WORKTREE, "vite.config.ts")).href)).toBe(ROOT);
	});

	it("throws rather than guessing when nothing above declares workspaces", () => {
		const alone = mkdtempSync(join(tmpdir(), "no-workspace-"));
		expect(() => workspaceRoot(alone)).toThrow(/workspaces/);
	});
});
