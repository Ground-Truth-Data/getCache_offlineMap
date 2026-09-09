/**
 * ⛔ never hardcode a child's name here — rapper mounts exactly one, chosen at install time; mounted.json says which.
 * ⛔ a child shipping no fetchAssets.sh is normal, not an error — must exit 0 or this reintroduces the failure it fixes.
 * ⛔ never swallow a child's fetchAssets.sh failure — propagate its exit code unchanged; that's the child's policy to set, not this wrapper's to overrule.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIM = "\x1b[2m", YEL = "\x1b[0;33m", GRN = "\x1b[0;32m", NC = "\x1b[0m";

let child;
try {
	child = (await import("./mounted.mjs")).mountedChild();
} catch (e) {
	console.warn(`${YEL}assets: could not read mounted.json (${e.message}) — skipping.${NC}`);
	process.exit(0);
}
if (!child) {
	console.log(`${DIM}assets: no child mounted (workspace checkout) — nothing to copy.${NC}`);
	process.exit(0);
}
const childDir = resolve(ROOT, "..", child);
const script = resolve(childDir, "fetchAssets.sh");

if (!existsSync(script)) {
	console.log(`${DIM}assets: this child ships no fetchAssets.sh — nothing to copy.${NC}`);
	process.exit(0);
}

const r = spawnSync("bash", [script, "static/mobileAssets"], { stdio: "inherit", cwd: ROOT });

if (r.status !== 0) {
	console.error("");
	console.error(`${YEL}assets: that child's fetchAssets.sh failed, so \`npm run dev\` stops here.${NC}`);
	console.error(`${DIM}   The failure above is the CHILD's, reported in its own words — see its ASSETS.md.${NC}`);
	console.error(`${DIM}   To start the server anyway: npm run dev --ignore-scripts${NC}`);
	console.error("");
}

process.exit(r.status ?? 1);
