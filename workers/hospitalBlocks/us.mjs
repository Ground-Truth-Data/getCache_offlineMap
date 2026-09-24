// USA: CMS « Hospital General Information » replaces OSM inside the Natural
// Earth "United States of America" feature. The CSV has no coordinates, so rows
// are geocoded through the free Census Bureau geocoder; rows it cannot place
// are skipped, never invented.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
	BLOCKS_CACHE,
	BAKE_UA,
	cachedDownload,
	colIndex,
	makeEntry,
	parseCsv,
} from "./lib.mjs";
import { countryContains } from "./countries.mjs";

export const countryCode = "US";
export const source =
	"CMS « Hospital General Information » (xubh-q36u), public domain, geocoded via the US Census Bureau geocoder — fetched 2026-09-01";

export async function bounds() {
	return countryContains("United States of America");
}

const GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations";
const BENCHMARK = "Public_AR_Current";

/** Explicit "No" for Emergency Services drops the row; blank → null (unknown). */
export function parseCms(csvText) {
	const rows = parseCsv(csvText);
	const col = colIndex(rows[0], [
		"Facility ID",
		"Facility Name",
		"Address",
		"City/Town",
		"State",
		"ZIP Code",
		"Telephone Number",
		"Emergency Services",
	]);
	const out = [];
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i];
		const es = (r[col["Emergency Services"]] ?? "").trim();
		if (/^no$/i.test(es)) continue;
		out.push({
			id: r[col["Facility ID"]],
			name: r[col["Facility Name"]].trim(),
			address: r[col["Address"]].trim(),
			city: r[col["City/Town"]].trim(),
			state: r[col["State"]].trim(),
			zip: r[col["ZIP Code"]].trim(),
			phone: (r[col["Telephone Number"]] ?? "").trim(),
			emergency: /^yes$/i.test(es) ? "yes" : null,
		});
	}
	return out;
}

/** id → [lng, lat], or null for No_Match/Tie. */
export function parseBatchGeocode(text) {
	const out = new Map();
	for (const r of parseCsv(text)) {
		if (r.length < 3) continue;
		if (r[2] === "Match" && r[5]) {
			const [lng, lat] = r[5].split(",").map(Number);
			if (Number.isFinite(lng) && Number.isFinite(lat)) {
				out.set(r[0], [lng, lat]);
				continue;
			}
		}
		out.set(r[0], null);
	}
	return out;
}

const q = (s) => `"${String(s).replaceAll('"', '""')}"`;

async function geocodeBatch(rows) {
	const csv = rows
		.map((r) => [r.id, r.address, r.city, r.state, r.zip].map(q).join(","))
		.join("\n");
	const form = new FormData();
	form.append("addressFile", new Blob([csv], { type: "text/csv" }), "addresses.csv");
	form.append("benchmark", BENCHMARK);
	const res = await globalThis.fetch(`${GEOCODER}/addressbatch`, {
		method: "POST",
		body: form,
		headers: { "User-Agent": BAKE_UA },
	});
	if (!res.ok) throw new Error(`census addressbatch: HTTP ${res.status}`);
	return parseBatchGeocode(await res.text());
}

async function geocodeOneline(row) {
	const address = `${row.address}, ${row.city}, ${row.state} ${row.zip}`;
	const url =
		`${GEOCODER}/onelineaddress?address=${encodeURIComponent(address)}` +
		`&benchmark=${BENCHMARK}&format=json`;
	const res = await globalThis.fetch(url, { headers: { "User-Agent": BAKE_UA } });
	if (!res.ok) return null;
	const m = (await res.json()).result?.addressMatches?.[0]?.coordinates;
	return Number.isFinite(m?.x) && Number.isFinite(m?.y) ? [m.x, m.y] : null;
}

export async function fetch() {
	const dir = `${BLOCKS_CACHE}us/`;
	const cms = parseCms(
		await cachedDownload(async () => {
			const api =
				"https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/xubh-q36u";
			const res = await globalThis.fetch(api);
			if (!res.ok) throw new Error(`${api}: HTTP ${res.status}`);
			const url = (await res.json()).distribution?.[0]?.downloadURL;
			if (!url) throw new Error("xubh-q36u: no distribution downloadURL");
			return url;
		}, `${dir}Hospital_General_Information.csv`),
	);

	// Misses are cached as empty coords so a rerun never re-asks a refused address.
	const cacheFile = `${dir}census-geocoded.csv`;
	const coords = new Map();
	if (existsSync(cacheFile)) {
		for (const line of readFileSync(cacheFile, "utf8").split("\n")) {
			if (!line) continue;
			const [id, lng, lat] = line.split(",");
			coords.set(id, lng ? [Number(lng), Number(lat)] : null);
		}
	}
	const persist = () => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			cacheFile,
			[...coords]
				.map(([id, c]) => (c ? `${id},${c[0]},${c[1]}` : `${id},,`))
				.join("\n") + "\n",
		);
	};
	const pending = cms.filter((r) => !coords.has(r.id));
	if (pending.length) {
		for (let i = 0; i < pending.length; i += 2000) {
			const chunk = pending.slice(i, i + 2000);
			const got = await geocodeBatch(chunk);
			for (const r of chunk) coords.set(r.id, got.get(r.id) ?? null);
			persist();
			console.log(`[block US] census batch ${i / 2000 + 1}: ${chunk.length} sent`);
		}
		let retried = 0;
		for (const r of pending) {
			if (coords.get(r.id) !== null) continue;
			coords.set(r.id, await geocodeOneline(r));
			if (++retried % 50 === 0) persist();
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
		persist();
		if (retried) console.log(`[block US] onelineaddress retries: ${retried}`);
	}

	const entries = [];
	let skipped = 0;
	for (const r of cms) {
		const c = coords.get(r.id);
		if (!c) {
			skipped++;
			continue;
		}
		entries.push(makeEntry(c[0], c[1], r.name, r.emergency, r.phone || undefined));
	}
	if (skipped)
		console.log(`[block US] ${skipped} rows the geocoder could not place — skipped`);
	entries.sort((a, b) => (b[3] === "yes") - (a[3] === "yes"));
	return entries;
}
