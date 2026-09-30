import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The guards police the WORKSPACE — children are siblings of both parents — so a
// tier's config must hand them the workspace root, and `new URL("..", import.meta.url)`
// is that only where the tier sits directly in it. From a card worktree
// (`fetch/.wt/<card>/ReTreever`) it is `.wt/<card>`, while Vite resolves every
// symlinked sibling to its real path under `fetch/`, so a sibling's own `./x`
// import "escaped" and every route 500ed. Found the way Vite finds it: the
// nearest package.json above that declares `workspaces`.

/** Nearest folder above `from` (a path or a `file:` URL) whose package.json declares `workspaces`. */
export function workspaceRoot(from: string): string {
	const start = from.startsWith("file:") ? dirname(fileURLToPath(from)) : from;
	for (let dir = start; ; ) {
		if (declaresWorkspaces(join(dir, "package.json"))) return dir;
		const up = dirname(dir);
		if (up === dir) {
			throw new Error(
				`No package.json with "workspaces" above ${start} — the guards need the workspace root, not this folder's position in it.`,
			);
		}
		dir = up;
	}
}

function declaresWorkspaces(pkg: string): boolean {
	if (!existsSync(pkg)) return false;
	try {
		return Boolean(JSON.parse(readFileSync(pkg, "utf8")).workspaces);
	} catch {
		return false;
	}
}
