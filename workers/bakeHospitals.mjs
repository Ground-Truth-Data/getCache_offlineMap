#!/usr/bin/env node
// Bakes the world hospital pack the Worker's /hospitals route serves, from OSM
// amenity=hospital via Overpass; a country with a trusted registry (hospitalBlocks/)
// has every OSM row inside it replaced by the registry's rows. Format is in
// hospitals.ts. Bake in worker-local-dev only; the deploy scripts sync the .bin.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { makeEntry } from "./hospitalBlocks/lib.mjs";
import * as blockFr from "./hospitalBlocks/fr.mjs";
import * as blockUs from "./hospitalBlocks/us.mjs";

const BLOCKS = [blockFr, blockUs];

// (S, W, N, E), sized for one Overpass answer each. Overlap is free (dedupe below); a gap drops a continent.
const REGIONS = [
	["north-america", 5, -170, 84, -50],
	["greenland", 58, -75, 84, -10],
	["iceland-n-atlantic", 55, -35, 68, -10],
	["south-america", -60, -90, 15, -30],
	["europe", 35, -25, 72, 45],
	["africa", -35, -20, 38, 55],
	["middle-east", 12, 25, 45, 65],
	["central-asia", 35, 45, 55, 90],
	["north-asia", 50, 45, 82, 180],
	["south-asia", 5, 60, 40, 100],
	["east-asia", 18, 73, 55, 150],
	["southeast-asia", -15, 90, 30, 155],
	["oceania", -50, 100, 0, 180],
	["west-pacific", -20, 150, 25, 180],
	["southern-ocean-w", -90, -180, -50, 0],
	["southern-ocean-e1", -90, 0, -50, 90],
	["southern-ocean-e2", -90, 90, -50, 180],
];

const ENDPOINTS = [
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
];

const CELL_DEG = 5;
const OUT = new URL("./worker-local-dev/src/hospitalsWorld.v1.bin", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRegion(name, s, w, n, e) {
	const bbox = `${s},${w},${n},${e}`;
	const query =
		`[out:json][timeout:300];` +
		`(node["amenity"="hospital"](${bbox});` +
		`way["amenity"="hospital"](${bbox});` +
		`relation["amenity"="hospital"](${bbox}););` +
		`out center;`;
	for (let attempt = 0; attempt < 6; attempt++) {
		const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
		try {
			const res = await fetch(endpoint, {
				method: "POST",
				body: `data=${encodeURIComponent(query)}`,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					// overpass-api.de 406es Node's default UA.
					"User-Agent": "getcache-hospitals-bake/1.0 (https://getcache.org)",
				},
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = await res.json();
			return json.elements ?? [];
		} catch (err) {
			console.warn(`[${name}] attempt ${attempt + 1} failed (${endpoint}): ${err.message}`);
			await sleep(10_000 * (attempt + 1));
		}
	}
	throw new Error(`[${name}] all attempts failed — a gap here would silently drop a continent`);
}

// Overpass drops regions under load; a rerun must not re-download a continent to retry an island.
const CACHE_DIR = new URL("./.bake-cache/", import.meta.url).pathname;
mkdirSync(CACHE_DIR, { recursive: true });

const byCoord = new Map();
for (const [name, s, w, n, e] of REGIONS) {
	const cacheFile = `${CACHE_DIR}${name}.json`;
	let elements;
	if (existsSync(cacheFile)) {
		elements = JSON.parse(readFileSync(cacheFile, "utf8"));
		console.log(`[${name}] cached (${elements.length})`);
	} else {
		elements = await fetchRegion(name, s, w, n, e);
		writeFileSync(cacheFile, JSON.stringify(elements));
		await sleep(5000);
	}
	let kept = 0;
	for (const el of elements) {
		const lat = el.lat ?? el.center?.lat;
		const lon = el.lon ?? el.center?.lon;
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		// An explicit "no" is dropped; untagged stays, because most real ERs are untagged.
		if (el.tags?.emergency === "no") continue;
		const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
		if (byCoord.has(key)) continue;
		const emergency =
			typeof el.tags?.emergency === "string" ? el.tags.emergency : null;
		const phone = (el.tags?.phone ?? el.tags?.["contact:phone"])?.trim();
		byCoord.set(
			key,
			makeEntry(lon, lat, el.tags?.name ?? "Hospital", emergency, phone || undefined),
		);
		kept++;
	}
	console.log(`[${name}] fetched ${elements.length}, new after dedupe ${kept} (total ${byCoord.size})`);
}

for (const block of BLOCKS) {
	const contains = await block.bounds();
	let dropped = 0;
	for (const [key, entry] of byCoord) {
		if (contains(entry[0], entry[1])) {
			byCoord.delete(key);
			dropped++;
		}
	}
	const rows = await block.fetch();
	let added = 0;
	let outside = 0; // e.g. CMS rows in Puerto Rico: a separate NE feature, stays OSM-covered
	let collided = 0;
	for (const entry of rows) {
		if (!contains(entry[0], entry[1])) {
			outside++;
			continue;
		}
		const key = `${entry[1].toFixed(5)},${entry[0].toFixed(5)}`;
		if (byCoord.has(key)) {
			collided++;
			continue;
		}
		byCoord.set(key, entry);
		added++;
	}
	console.log(
		`[block ${block.countryCode}] OSM dropped ${dropped}, registry added ${added}` +
			(outside ? `, outside-bounds skipped ${outside}` : "") +
			(collided ? `, same-coord collapsed ${collided}` : "") +
			` — ${block.source}`,
	);
}

if (byCoord.size < 50_000) {
	// OSM holds ~190k; far fewer means a region came back thin.
	throw new Error(`only ${byCoord.size} hospitals — refusing to bake a hollow world`);
}

const cells = new Map();
for (const entry of byCoord.values()) {
	const [lng, lat] = entry;
	const cy = Math.min(35, Math.max(0, Math.floor((lat + 90) / CELL_DEG)));
	const cx = Math.min(71, Math.max(0, Math.floor((lng + 180) / CELL_DEG)));
	const k = `${cy}_${cx}`;
	if (!cells.has(k)) cells.set(k, []);
	cells.get(k).push(entry);
}

const enc = new TextEncoder();
const blobs = [];
const index = {
	v: 1,
	cellDeg: CELL_DEG,
	count: byCoord.size,
	generated: new Date().toISOString().slice(0, 10),
	cells: {},
};
let offset = 0;
for (const [k, entries] of [...cells.entries()].sort()) {
	const bytes = enc.encode(JSON.stringify(entries));
	index.cells[k] = [offset, bytes.byteLength];
	blobs.push(bytes);
	offset += bytes.byteLength;
}
const indexBytes = enc.encode(JSON.stringify(index));
const out = new Uint8Array(4 + indexBytes.byteLength + offset);
new DataView(out.buffer).setUint32(0, indexBytes.byteLength, true);
out.set(indexBytes, 4);
let pos = 4 + indexBytes.byteLength;
for (const b of blobs) {
	out.set(b, pos);
	pos += b.byteLength;
}
writeFileSync(OUT, out);
console.log(
	`\n✅ ${OUT}\n   ${index.count} hospitals, ${cells.size} cells, ${(out.byteLength / 1e6).toFixed(1)} MB`,
);
console.log(
	`\nSet in worker-local-dev/src/index.ts:  const HOSPITALS_BUILD = "v1-${index.count}-${index.generated.replaceAll("-", "")}";\nThen deploy (deployDev.sh → smoke → deployProduction.sh).`,
);
