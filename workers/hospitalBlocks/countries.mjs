// "Inside a country" must be one deterministic answer: Natural Earth 1:10m admin-0.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BAKE_UA } from "./lib.mjs";

const NE_URL =
	"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson";
const NE_FILE = new URL(
	"../.bake-cache/ne_10m_admin_0_countries.geojson",
	import.meta.url,
).pathname;

let featuresPromise;

async function loadFeatures() {
	featuresPromise ??= (async () => {
		let text;
		if (existsSync(NE_FILE)) text = readFileSync(NE_FILE, "utf8");
		else {
			const res = await globalThis.fetch(NE_URL, {
				headers: { "User-Agent": BAKE_UA },
			});
			if (!res.ok) throw new Error(`${NE_URL}: HTTP ${res.status}`);
			text = await res.text();
			mkdirSync(dirname(NE_FILE), { recursive: true });
			writeFileSync(NE_FILE, text);
		}
		return JSON.parse(text).features;
	})();
	return featuresPromise;
}

/** Even-odd ray cast. */
export function inRing(lng, lat, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (
			yi > lat !== yj > lat &&
			lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
		)
			inside = !inside;
	}
	return inside;
}

/** (lng, lat) tester for one (Multi)Polygon; even-odd across rings so holes count out. */
export function featureTester(feature) {
	const g = feature.geometry;
	const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
	const boxed = polys.map((rings) => {
		let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
		for (const [x, y] of rings[0]) {
			if (x < w) w = x;
			if (x > e) e = x;
			if (y < s) s = y;
			if (y > n) n = y;
		}
		return { rings, w, s, e, n };
	});
	return (lng, lat) => {
		for (const p of boxed) {
			if (lng < p.w || lng > p.e || lat < p.s || lat > p.n) continue;
			let inside = false;
			for (const ring of p.rings) if (inRing(lng, lat, ring)) inside = !inside;
			if (inside) return true;
		}
		return false;
	};
}

/** Dependencies (Puerto Rico, Saint-Pierre-et-Miquelon) are separate NE features and stay OSM-covered. */
export async function countryContains(neName) {
	const features = await loadFeatures();
	const f = features.find((ft) => ft.properties.NAME === neName);
	if (!f) throw new Error(`Natural Earth: no admin-0 feature named "${neName}"`);
	return featureTester(f);
}
