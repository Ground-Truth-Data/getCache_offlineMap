import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

// rapper's own copy of ReTreever's src/lib/core/harnessGuards/noEscapePlugin.ts — a guard that had to raw-climb into a parent to be imported wouldn't be a guard. ⚠️ Keep the two byte-identical below this line; there is no build step that checks that for you.
// Rule: inside the repo, `../` is ordinary; leaving the repo is allowed ONLY through an alias ($parent/siblings, $lib …); node_modules/virtual modules are exempt.
// ⚠️ Case must match exactly what readdir reports, never just whether the file opens — APFS is case-insensitive so a wrong-case import 200s locally and 404s on Vercel's Linux build.

// Does this path exist with EXACTLY this spelling?
function exactCase(abs: string): boolean {
	if (!existsSync(abs)) return false;
	let cur = resolve(sep);
	for (const seg of relative(sep, abs).split(sep)) {
		if (!seg) continue;
		let names: string[];
		try {
			names = readdirSync(cur);
		} catch {
			return true; // unreadable parent — not this plugin's business
		}
		if (!names.includes(seg)) return false;
		cur = join(cur, seg);
	}
	return true;
}

// Returns null for a file in a parent (ReTreever, rapper) — parents are allowed to reach their own code.
function childRootOf(file: string, workspace: string): string | null {
	let cur = dirname(file);
	while (cur.startsWith(workspace) && cur !== workspace) {
		const parent = dirname(cur);
		if (parent === workspace && existsSync(join(cur, "lib"))) return cur;
		cur = parent;
	}
	return null;
}

export function noEscapeHatch(repoRoot: string): Plugin {
	const root = resolve(repoRoot);

	return {
		name: "rt-no-escape-hatch",

		// ⚠️ Must stay "pre", not "post" — at "post" Rollup never calls this (vite's own resolver already resolved everything first), so a deliberate escape builds clean with zero warning.
		enforce: "pre",

		resolveId(source, importer) {
			if (!importer) return null;
			if (!source.startsWith(".")) return null; // bare specifier — a package
			if (importer.includes("node_modules")) return null;
			if (importer.startsWith("\0") || source.startsWith("\0")) return null;

			const target = resolve(importer, "..", source.split("?")[0]);

			// ⚠️ CHARGE 1: boundary must be the CHILD, not the workspace — using the workspace as boundary let a child import straight out of ReTreever silently, since both parents live inside the workspace too.
			const boundary = childRootOf(importer, root) ?? root;
			const rel = relative(boundary, target);
			const escaped = rel.startsWith("..") || isAbsolute(rel);
			if (escaped && !target.includes("node_modules")) {
				const isChild = boundary !== root;
				throw new Error(
					`\n\n  ${isChild ? "A CHILD REACHED OUTSIDE ITSELF" : "RAW PATH ESCAPED THE REPO"} — build stopped.\n\n` +
						`    in:      ${relative(root, importer)}\n` +
						`    import:  ${source}\n` +
						`    lands:   ${relative(root, target)}\n` +
						`    allowed: ${relative(root, boundary) || "the repo"}/**\n\n` +
						(isChild
							? `  A child has TWO possible parents and must run under either,\n` +
								`  so it may never reach one by path. Side by side on one\n` +
								`  machine such a path RESOLVES — which is exactly why this\n` +
								`  has to stop the build rather than wait to be noticed. It\n` +
								`  resolves to nothing the moment the child is cloned alone.\n\n` +
								`  Take what you need as a PROP from the parent that mounted\n` +
								`  you, or import it from your own folder. Never by path.\n`
							: `  Leaving the repo is allowed ONLY through an alias, because\n` +
								`  an alias is one declared line somebody can review and\n` +
								`  repoint. A raw ../../ climb hardcodes today's folder layout\n` +
								`  into a source file, and it breaks silently the next time\n` +
								`  anything moves.\n\n` +
								`  Use $parent/siblings/<child>/... (svelte.config.js kit.alias), or\n` +
								`  move the file inside the repo.\n`),
				);
			}

			// CHARGE 2: is the spelling right?
			if (/\.[a-z0-9]+$/i.test(target) && existsSync(target) && !exactCase(target)) {
				throw new Error(
					`\n\n  IMPORT CASE DOES NOT MATCH DISK — build stopped.\n\n` +
						`    in:     ${relative(root, importer)}\n` +
						`    import: ${source}\n\n` +
						`  This resolves on macOS ONLY because APFS is case-insensitive.\n` +
						`  Linux is not, and Linux is what the deploy builds on — so this\n` +
						`  renders perfectly on every Mac here and 404s in production.\n\n` +
						`  Fix the spelling to match the folder exactly.\n`,
				);
			}

			return null; // not ours to resolve — just watching the door
		},
	};
}
