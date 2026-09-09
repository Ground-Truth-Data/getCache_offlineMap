/**
 * `npm run dev` = vite + the mounted child's local tile worker, one command.
 *
 * The offline map's worker-local-dev tier is a separate wrangler process; without it
 * every download dies on the only tier a contributor can reach, and the
 * handoff needed a "second terminal" paragraph. This starts it alongside vite
 * when (and only when) the mounted child ships one.
 *
 * Skips the worker, never fails the dev server, when:
 *  - no sibling child has workers/worker-local-dev with a dev:local script
 *  - port 8787 is already listening (a worker is running — the workspace case)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");

// scaffold layout: child INSIDE the wrapper (rapper/getCache_OfflineMap);
// workspace layout: child BESIDE it (fetch/getCache_OfflineMap). Probe both.
const workerDir = ["getCache_OfflineMap/workers/worker-local-dev", "../getCache_OfflineMap/workers/worker-local-dev"]
	.map((p) => path.resolve(root, p))
	.find((p) => existsSync(path.join(p, "package.json")));

const portBusy = (port) =>
	new Promise((done) => {
		const s = net.connect({ port, host: "127.0.0.1" }, () => {
			s.destroy();
			done(true);
		});
		s.on("error", () => done(false));
		s.setTimeout(500, () => {
			s.destroy();
			done(false);
		});
	});

const children = [];
// ⚠️ detached + group-kill, not p.kill() — `npm run` is an intermediary, and killing
// it alone ORPHANS the real vite/wrangler underneath (measured: servers kept
// answering after the wrapper exited 0). detached gives each child its own
// process group, so kill(-pid) takes the grandchildren with it.
const start = (cmd, args, opts, name) => {
	const p = spawn(cmd, args, { stdio: "inherit", detached: true, ...opts });
	p.on("exit", (code) => {
		// vite dying ends the run; the worker dying just logs — the app still works against cloud tiers.
		if (name === "vite") shutdown(code ?? 0);
		else console.error(`[dev] ${name} exited (${code}) — worker-local-dev tier is down until you restart it.`);
	});
	children.push(p);
	return p;
};
const shutdown = (code) => {
	for (const p of children) {
		try {
			process.kill(-p.pid, "SIGTERM");
		} catch {
			/* already gone */
		}
	}
	process.exit(code);
};
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (workerDir && !(await portBusy(8787))) {
	if (!existsSync(path.join(workerDir, "node_modules"))) {
		console.log("[dev] installing the local tile worker (first run only)…");
		const r = spawnSync("npm", ["install"], { cwd: workerDir, stdio: "inherit" });
		if (r.status !== 0) console.error("[dev] worker install failed — starting vite without it.");
	}
	if (existsSync(path.join(workerDir, "node_modules"))) {
		console.log("[dev] starting the local tile worker on :8787…");
		start("npm", ["run", "dev"], { cwd: workerDir }, "tile worker");
	}
} else if (workerDir) {
	console.log("[dev] a tile worker already answers on :8787 — not starting another.");
}

start("npm", ["run", "dev:vite"], { cwd: root }, "vite");
