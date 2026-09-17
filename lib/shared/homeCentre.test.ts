// The map home is ONE pair of numbers. `homeCentre.ts` says so in its first
// line — "Never copy these numbers to a second file" — and until this test
// nothing enforced it: `routes/offlinev10/+page.svelte` had its own fallback
// centre 3,000 km away, so a cold open on the offline map landed in British
// Columbia while a cold open on the online map landed in Ontario. The two maps
// share one saved camera precisely so the crow toggle keeps its place; two
// different homes made that promise false whenever there was nothing saved yet.
//
// A behavioural test cannot see this. Both files are internally consistent, and
// the bug only shows on a device with no saved camera — so what has to be
// checked is the SOURCE: does any file other than the one definition contain a
// coordinate pair?

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAP_HOME_CENTER } from "./homeCentre.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const OWNER = "lib/shared/homeCentre.ts";

/** The sandbox has its own home on purpose — a seeded practice map. */
const ALLOWED = new Set([OWNER, "lib/mapState/mapViewport.ts"]);

async function sourceFiles(dir: string, acc: string[] = []): Promise<string[]> {
	for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name.startsWith(".")) continue;
		const rel = `${dir}/${e.name}`;
		if (e.isDirectory()) await sourceFiles(rel, acc);
		else if (/\.(ts|svelte)$/.test(e.name) && !e.name.includes(".test.")) acc.push(rel);
	}
	return acc;
}

describe("the map home is defined once", () => {
	it("is a real pair of coordinates, not a placeholder", () => {
		const [lng, lat] = MAP_HOME_CENTER;
		expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true);
		// Null island is what an unset camera decays to, and it is in the ocean.
		expect(lng === 0 && lat === 0).toBe(false);
		expect(Math.abs(lat)).toBeLessThanOrEqual(90);
		expect(Math.abs(lng)).toBeLessThanOrEqual(180);
	});

	it("spells its numbers in NO other file", async () => {
		const [lng, lat] = MAP_HOME_CENTER;
		// Enough digits to be this constant and not a coincidence.
		const needles = [lng.toFixed(4), lat.toFixed(4)];
		const files = [
			...(await sourceFiles("lib")),
			...(await sourceFiles("routes")),
		];
		const copies = files.filter((f) => {
			if (f.replace(/^\//, "") === OWNER) return false;
			const text = readFileSync(join(ROOT, f), "utf8");
			return needles.some((n) => text.includes(n));
		});
		expect(copies, `the home centre is copied into: ${copies.join(", ")}`).toEqual([]);
	});

	it("is what a cold open falls back to, in every map that has a fallback", async () => {
		// A hardcoded lat/lng pair in a camera fallback is the bug this file
		// exists for, wherever it appears. Caught by shape, not by value, so a
		// DIFFERENT wrong pair is caught too.
		const files = [
			...(await sourceFiles("lib")),
			...(await sourceFiles("routes")),
		];
		const offenders: string[] = [];
		for (const f of files) {
			if (ALLOWED.has(f.replace(/^\//, ""))) continue;
			const text = readFileSync(join(ROOT, f), "utf8");
			// `center: [<number>, <number>]` with literal numbers, not identifiers.
			const hit = text.match(/center:\s*\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\]/);
			if (hit) offenders.push(`${f} → ${hit[0]}`);
		}
		expect(
			offenders,
			`a literal centre belongs in ${OWNER}, not in: ${offenders.join(", ")}`,
		).toEqual([]);
	});
});
