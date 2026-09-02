// Shared plumbing for country-block adapters (see fr.mjs / us.mjs and the
// block law in .claude/skills/refresh-hospitals/SKILL.md). Plain Node only —
// the bake has no npm deps and must stay that way.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const BLOCKS_CACHE = new URL("../.bake-cache/blocks/", import.meta.url)
	.pathname;

export const BAKE_UA =
	"getcache-hospitals-bake/1.0 (https://getcache.org)";

/** Download once into the cache; reruns read the file and never touch the
 *  network. `url` may be a thunk (e.g. a resource-discovery API call) so a
 *  cache hit skips discovery too. */
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

/** RFC-4180 CSV → array of row arrays. Handles quoted fields with embedded
 *  delimiters/quotes/newlines, CRLF, and a leading UTF-8 BOM. */
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

/** Header row → {name: index}; a missing column throws so a silently
 *  reshuffled export fails loudly instead of shipping garbage. */
export function colIndex(header, names) {
	const map = {};
	for (const name of names) {
		const i = header.indexOf(name);
		if (i === -1) throw new Error(`csv: missing column "${name}"`);
		map[name] = i;
	}
	return map;
}

/** Canonical pack entry [lng, lat, name, emergency, phone] with trailing
 *  null/absent fields trimmed, so old-shape entries stay valid. emergency is a
 *  string ("yes"/"ambulance_station"/…) or null for unknown; null survives
 *  only as a placeholder before a phone. */
export function makeEntry(lng, lat, name, emergency = null, phone = undefined) {
	const e = [Number(lng.toFixed(5)), Number(lat.toFixed(5)), name, emergency, phone];
	while (e.length > 3 && (e[e.length - 1] === null || e[e.length - 1] === undefined))
		e.pop();
	return e;
}
