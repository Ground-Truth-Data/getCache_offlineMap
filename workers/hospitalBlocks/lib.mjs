// Plain Node only: the bake has no npm deps.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const BLOCKS_CACHE = new URL("../.bake-cache/blocks/", import.meta.url)
	.pathname;

export const BAKE_UA =
	"getcache-hospitals-bake/1.0 (https://getcache.org)";

/** `url` may be a thunk so a cache hit skips resource discovery too. */
export async function cachedDownload(url, cacheFile) {
	if (existsSync(cacheFile)) return readFileSync(cacheFile, "utf8");
	const resolved = typeof url === "function" ? await url() : url;
	const res = await globalThis.fetch(resolved, {
		headers: { "User-Agent": BAKE_UA },
	});
	if (!res.ok) throw new Error(`${resolved}: HTTP ${res.status}`);
	const body = await res.text();
	mkdirSync(dirname(cacheFile), { recursive: true });
	writeFileSync(cacheFile, body);
	return body;
}

/** RFC-4180 CSV → rows; handles quoted fields, CRLF and a leading BOM. */
export function parseCsv(text, delim = ",") {
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	const rows = [];
	let row = [];
	let i = 0;
	const n = text.length;
	while (i < n) {
		let field;
		if (text[i] === '"') {
			let j = i + 1;
			let out = "";
			for (;;) {
				const q = text.indexOf('"', j);
				if (q === -1) throw new Error("csv: unterminated quote");
				if (text[q + 1] === '"') {
					out += text.slice(j, q + 1);
					j = q + 2;
				} else {
					out += text.slice(j, q);
					i = q + 1;
					break;
				}
			}
			field = out;
		} else {
			let j = i;
			while (j < n && text[j] !== delim && text[j] !== "\n" && text[j] !== "\r")
				j++;
			field = text.slice(i, j);
			i = j;
		}
		row.push(field);
		if (i >= n) {
			rows.push(row);
			row = [];
			break;
		}
		const c = text[i];
		if (c === delim) i++;
		else {
			if (c === "\r") i += text[i + 1] === "\n" ? 2 : 1;
			else i++;
			rows.push(row);
			row = [];
		}
	}
	if (row.length) rows.push(row);
	const last = rows[rows.length - 1];
	if (last && last.length === 1 && last[0] === "") rows.pop();
	return rows;
}

/** A missing column throws so a reshuffled export fails loudly. */
export function colIndex(header, names) {
	const map = {};
	for (const name of names) {
		const i = header.indexOf(name);
		if (i === -1) throw new Error(`csv: missing column "${name}"`);
		map[name] = i;
	}
	return map;
}

/** [lng, lat, name, emergency, phone] with trailing null/absent fields trimmed. */
const R_KM = 6371;
function km(a, b) {
	const dLat = ((b[1] - a[1]) * Math.PI) / 180;
	const dLng = ((b[0] - a[0]) * Math.PI) / 180;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
	return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/** Every ER (emergency=yes), and a hospital whose ER is unconfirmed only where no ER is within
 *  `withinKm`: in most countries OSM leaves real ERs untagged, and a rural planter's only
 *  hospital must not vanish. An explicit "no" is dropped; any other value ships as unconfirmed. */
export function erOrLonely(entries, withinKm = 50) {
	const cell = (lng, lat) => `${Math.floor(lat)}_${((Math.floor(lng) % 360) + 360) % 360}`;
	const ers = new Map();
	for (const e of entries)
		if (e[3] === "yes") {
			const k = cell(e[0], e[1]);
			if (!ers.has(k)) ers.set(k, []);
			ers.get(k).push(e);
		}
	const nearEr = (e) => {
		const dLat = Math.ceil(withinKm / 111);
		const dLng = Math.min(180, Math.ceil(withinKm / (111 * Math.max(0.01, Math.cos((e[1] * Math.PI) / 180)))));
		for (let y = -dLat; y <= dLat; y++)
			for (let x = -dLng; x <= dLng; x++)
				for (const er of ers.get(cell(e[0] + x, e[1] + y)) ?? []) if (km(e, er) <= withinKm) return true;
		return false;
	};
	const out = [];
	for (const e of entries) {
		if (e[3] === "yes") out.push(e);
		else if (e[3] !== "no" && !nearEr(e)) out.push(makeEntry(e[0], e[1], e[2], null, e[4]));
	}
	return out;
}

export function makeEntry(lng, lat, name, emergency = null, phone = undefined) {
	const e = [Number(lng.toFixed(5)), Number(lat.toFixed(5)), name, emergency, phone];
	while (e.length > 3 && (e[e.length - 1] === null || e[e.length - 1] === undefined))
		e.pop();
	return e;
}
