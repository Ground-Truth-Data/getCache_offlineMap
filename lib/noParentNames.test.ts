/**
 * A child may not name a parent as a LOCATION. The escape plugin misses this:
 * side by side, `../ReTreever/src/lib/foo` resolves, and stops resolving the
 * moment the folder is published alone. A test, not a plugin, because a child
 * has no build to hook. `$parent/siblings/...` names no parent and is allowed.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CHILD = fileURLToPath(new URL("..", import.meta.url));
const EXT = new Set([".svelte", ".ts", ".js", ".css", ".json"]);

// Tests are exempt: no parent bundles them, and the contract tests name parents on purpose.
const isTest = (name: string) => /\.test\.[^.]+$/.test(name);

function sources(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "assets") continue;
		if (e.name.startsWith(".")) continue;
		if (e.name === "_rapper" || e.name === "_siblings") continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) sources(full, out);
		else if (EXT.has(extname(e.name)) && !isTest(e.name)) out.push(full);
	}
	return out;
}

// `Symbol.for("retreever.…")` is a namespaced registry key, not a location.
const BRAND_STRING = /Symbol\.for\(/;

// A parent as a path segment, import or URL host, mid-path OR terminal
// (`href="{GH}/rapper"`), never this child's own folder name or prose.
const PARENT_AS_LOCATION =
	/(?:\.\.?\/|["'`({]\/?|\}\/|https?:\/\/[^"'`\s]*)(?:ReTreever|rapper|vercel)(?:[/.]|["'`)\s<]|$)/gi;

function offendersIn(root: string): string[] {
	const offenders: string[] = [];

		for (const file of sources(root)) {
			const text = readFileSync(file, "utf8");
			const lines = text.split("\n");
			// Block comments span lines; a plainly indented continuation line reads as code otherwise.
			let inBlockComment = false;
			for (const [i, line] of lines.entries()) {
				// Two lines joined so a Symbol.for(...) that wraps is still recognised.
				const stmt = `${lines[i - 1] ?? ""}\n${line}`;
				const t = line.trim();
				const wasInComment = inBlockComment;
				const opens = (line.match(/\/\*/g) ?? []).length;
				const closes = (line.match(/\*\//g) ?? []).length;
				if (opens > closes) inBlockComment = true;
				else if (closes > opens) inBlockComment = false;

				if (wasInComment || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
					continue;
				}
				if (BRAND_STRING.test(stmt)) continue;
				for (const m of line.matchAll(PARENT_AS_LOCATION)) {
					offenders.push(`${relative(root, file)}:${i + 1}  ${m[0]}`);
				}
			}
		}
	return offenders;
}

describe("the child names no parent", () => {
	it("no path, import or URL names ReTreever, rapper or vercel", () => {
		const offenders = offendersIn(CHILD);

		expect(
			offenders,
			`These name a PARENT as a location:\n\n` +
				offenders.map((o) => `  ${o}`).join("\n") +
				`\n\nA child has two possible parents and must run under either, so ` +
				`naming one is a defect even when the path resolves — and side by ` +
				`side on one machine, it DOES resolve. It stops resolving the ` +
				`moment this folder is published on its own, which is the point ` +
				`of the folder.\n\n` +
				`Reach a parent through the alias ($parent/siblings/...), or take what you ` +
				`need as a prop. Never by name.`,
		).toEqual([]);
	});

	it("the check bites — a parent-named path is detected", () => {
		const ok = 'import x from "$parent/siblings/getCache_OnlineMap/lib/foo";';
		expect([...ok.matchAll(PARENT_AS_LOCATION)].length).toBe(0);

		const bad = [
			'import x from "../ReTreever/src/lib/foo";',
			'href="{GH}/rapper"',
			'"https://github.com/Ground-Truth-Data/rapper"',
		];
		for (const b of bad) {
			expect(
				[...b.matchAll(PARENT_AS_LOCATION)].length,
				`should have been flagged: ${b}`,
			).toBeGreaterThan(0);
		}
	});

	// Guards the exclusions as much as the match: the same import planted in a
	// source file, a test file and a comment, and exactly the first must come back.
	it("the walker flags a real parent import, and only in a source file", () => {
		const root = mkdtempSync(join(tmpdir(), "noParentNames-"));
		try {
			mkdirSync(join(root, "lib"));
			const offending = 'import { x } from "../ReTreever/src/lib/foo";\n';
			writeFileSync(join(root, "lib", "real.ts"), offending);
			writeFileSync(join(root, "lib", "real.test.ts"), offending);
			writeFileSync(
				join(root, "lib", "prose.ts"),
				"// this comment mentions ../ReTreever/ and that is fine\nexport const y = 1;\n",
			);
			expect(offendersIn(root)).toEqual([`lib/real.ts:1  ../ReTreever/`]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
