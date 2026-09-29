#!/usr/bin/env node
// Writes the current repo's .env.schema Bitwarden block from `bws secret list`,
// regenerates .env from the schema, and fails the build when code reads a name
// the vault does not have. npm runs it as predev and prebuild, cwd = repo root.
//
// Bitwarden's name is the only name. The block between the two markers is
// written from the vault, so no hand-typed secret name exists to disagree with
// it; a repo declares every vault secret that its source, or the source of a
// child it serves, names. Vite inlines PUBLIC_* by scanning .env on disk before
// any process can inject them, so those keys, and only those, land in .env.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const SCHEMA = ".env.schema";
const ENV = ".env";
const BROWSER_PREFIX = "PUBLIC_";
const BEGIN = "# --- Bitwarden block: written from `bws secret list` by rapper/scripts/envFromBitwarden.mjs. Hand edits here are overwritten. ---";
const END = "# --- end Bitwarden block ---";
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=/gm;
const SOURCE = /\.(m?[jt]s|cjs|svelte|prisma|py|sh|json|toml|ya?ml)$/;
const SKIP_DIRS = new Set([
	".git", "node_modules", ".svelte-kit", ".svelte-kit-cap", ".vercel", "build", "build-cap",
	"dist", "ios", "android", "_rapper", "_siblings", ".wt", ".test", ".playwright-mcp",
]);

const BANNER = `# ############################################################################
# #  GENERATED — DO NOT EDIT. THIS FILE IS OVERWRITTEN ON EVERY BUILD.       #
# #  Written by rapper/scripts/envFromBitwarden.mjs from .env.schema.        #
# #  Secrets go in Bitwarden Secrets Manager. Names go in .env.schema.       #
# #  Anything you add here is gone on the next build.                        #
# ############################################################################
# shellcheck disable=SC2034  # editors lint this as shell; nothing here is "unused"
`;

const fail = (msg) => {
	console.error(`\n✘ envFromBitwarden: ${msg}\n`);
	process.exit(1);
};

// varlock exports no package.json; walk up from its entry file to its bin.
let varlockDir = path.dirname(createRequire(import.meta.url).resolve("varlock"));
while (!existsSync(path.join(varlockDir, "bin/cli.js"))) {
	const up = path.dirname(varlockDir);
	if (up === varlockDir) fail("cannot locate varlock's bin/cli.js from its package entry.");
	varlockDir = up;
}
const varlockBin = path.join(varlockDir, "bin/cli.js");
const varlock = (args, opts = {}) =>
	spawnSync(process.execPath, [varlockBin, ...args], { encoding: "utf8", ...opts });

if (!existsSync(SCHEMA)) {
	fail(`${process.cwd()} has no ${SCHEMA}. Every repo that reads a secret declares it there.`);
}
let schemaSrc = readFileSync(SCHEMA, "utf8");

// The folders whose source may name a secret this repo must resolve: itself,
// plus the children its svelte.config.js serves — they read the parent's .env.
const roots = ["."];
if (existsSync("svelte.config.js")) {
	for (const [, child] of readFileSync("svelte.config.js", "utf8").matchAll(/\$parent\/siblings\/(\w+)"/g)) {
		if (existsSync(path.join("..", child))) roots.push(path.join("..", child));
	}
}
function* sourceFiles(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.isDirectory()) {
			if (!SKIP_DIRS.has(e.name)) yield* sourceFiles(path.join(dir, e.name));
		} else if (SOURCE.test(e.name)) yield path.join(dir, e.name);
	}
}
const corpus = roots.flatMap((r) => [...sourceFiles(r)]).map((f) => readFileSync(f, "utf8")).join("\n");
const named = (key) => new RegExp(`(^|[^A-Za-z0-9_])${key}(?![A-Za-z0-9_])`).test(corpus);

// No bws (Vercel): the committed block stands. It was written from the vault
// on a developer's machine, and the audit below still proves it against code.
const bws = spawnSync("bws", ["secret", "list", "--output", "json"], { encoding: "utf8" });
if (bws.error?.code === "ENOENT") {
	if (!process.env.VERCEL) fail("bws CLI not on PATH. Install it:  curl https://bws.bitwarden.com/install | sh");
	console.warn(`⚠ envFromBitwarden: bws CLI not on PATH — ${SCHEMA} kept as committed, not rewritten from the vault.`);
} else {
	if (bws.status !== 0) fail(`bws secret list failed:\n${bws.stderr}`);
	const begin = schemaSrc.indexOf(BEGIN);
	const end = schemaSrc.indexOf(END);
	if (begin < 0 || end < begin) fail(`${SCHEMA} has no Bitwarden block. Add these two lines:\n  ${BEGIN}\n  ${END}`);
	const block = [BEGIN];
	const prefixed = [];
	const vault = JSON.parse(bws.stdout).sort((a, b) => a.key.localeCompare(b.key));
	const seen = new Set(vault.map((s) => s.key));
	// A pointer this machine account cannot read fails every `varlock run`, so it
	// cannot stay; declared empty, the audit still holds and the code that needs
	// the value fails at use. Chris's account sees everything and rewrites it back.
	const unseen = [...schemaSrc.slice(begin, end).matchAll(/^(\w+)=bitwarden\(/gm)]
		.map((m) => m[1])
		.filter((k) => !seen.has(k) && named(k));
	for (const s of vault) {
		if (named(s.key)) {
			// The note is the secret's documentation; an at-sign in it would read as a decorator.
			const note = (s.note ?? "").replace(/\s+/g, " ").replaceAll("@", "at ").trim();
			if (note) block.push(`# ${note}`);
			block.push(`# @auditIgnore${s.key.startsWith(BROWSER_PREFIX) ? "" : " @sensitive"}`);
			block.push(`${s.key}=bitwarden("${s.id}")`);
		} else if (named(BROWSER_PREFIX + s.key)) {
			prefixed.push(`${BROWSER_PREFIX}${s.key} is read; Bitwarden has "${s.key}". The browser needs the prefix, so the SECRET is renamed ${BROWSER_PREFIX}${s.key} in Bitwarden. Only Chris does that.`);
		}
	}
	for (const k of unseen) {
		block.push("# not readable by this machine account: empty here, fails where it is used");
		block.push(`# @auditIgnore${k.startsWith(BROWSER_PREFIX) ? "" : " @sensitive"}`);
		block.push(`${k}=`);
	}
	schemaSrc = schemaSrc.slice(0, begin) + block.join("\n") + "\n" + schemaSrc.slice(end);
	writeFileSync(SCHEMA, schemaSrc);
	console.log(`✓ envFromBitwarden: ${SCHEMA} Bitwarden block written from the vault (${(block.length - 1) / 3 | 0} secrets named in ${roots.join(", ")}).`);
	if (prefixed.length) console.warn(`⚠ envFromBitwarden:\n  ${prefixed.join("\n  ")}`);
	if (unseen.length) console.warn(`⚠ envFromBitwarden: this machine account cannot read ${unseen.join(", ")} — declared empty. Do not commit ${SCHEMA}; a full account rewrites it.`);
}

const schemaKeys = [...schemaSrc.matchAll(KEY_LINE)].map((m) => m[1]);
const bitwardenKeys = [...schemaSrc.matchAll(/^(\w+)=bitwarden\(/gm)].map((m) => m[1]);
if (schemaKeys.length === 0) fail(`${SCHEMA} declares no keys — this proves nothing.`);

// -p resolves from the schema ALONE. A value already sitting in .env would
// otherwise win over Bitwarden, and a rotated secret would never arrive.
const load = varlock(["load", "--format", "json", "-p", SCHEMA]);
if (load.status !== 0) fail(`varlock could not resolve ${SCHEMA}:\n${load.stderr || load.stdout}`);
const resolved = JSON.parse(load.stdout);

const unresolved = bitwardenKeys.filter((k) => !resolved[k]);
if (unresolved.length) {
	fail(
		`Bitwarden returned no value for: ${unresolved.join(", ")}.\n` +
			"  Check that this machine account can read that secret.",
	);
}

// Written before the audit: varlock overlays .env on the schema, so a stale
// generated file would report its old keys as drift.
const buildTime = schemaKeys.filter((k) => k.startsWith(BROWSER_PREFIX) && resolved[k]);
writeFileSync(ENV, BANNER + buildTime.map((k) => `${k}=${resolved[k]}`).join("\n") + "\n");

const audit = varlock(["audit"], { stdio: "inherit", encoding: undefined });
if (audit.status !== 0) {
	fail(
		"varlock audit found drift (above). A name code reads that Bitwarden lacks is fixed in the code,\n" +
			"  or Chris creates the secret in Bitwarden. A secret name is never typed into a schema.",
	);
}
console.log(
	`✓ envFromBitwarden: ${bitwardenKeys.length} Bitwarden pointers resolved, audit clean, ` +
		`${ENV} regenerated with ${buildTime.length} build-time keys.`,
);
