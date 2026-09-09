// The per-placemark <ExtendedData> rows of a Get Cache share.
//
// Google My Maps drops every HTML balloon on import and lists each <Data>
// row raw, name and value, under the pin — so these rows ARE the My Maps
// face of a share, and every one of them has to read as a label a planter
// would write. Google Earth never shows them (the placemark's BalloonStyle
// replaces the auto-listing with the styled card) and Get Cache reads them
// back on import, so each row is also a machine field: the writer and the
// reader below are one pair per row and must stay in step.

/** Row names as they appear under a pin in Google My Maps. */
export const WIRE = {
	pin: "Pin",
	type: "Type",
	madeWith: "Made with",
	data: "Data",
	contacts: "Contacts",
} as const;

/** The `Made with` value that marks a feature drawn in Get Cache — the
 *  provenance stamp on the wire, and the one brand mention My Maps shows. */
export const MADE_WITH_GETCACHE = "GetCache.org";

type Rec = Record<string, unknown>;

// ── featureData: JSON records ⇄ CSV ──────────────────────────────────

function parseRecords(json: string): Rec[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (Array.isArray(parsed)) {
		return parsed.filter(
			(r): r is Rec => r !== null && typeof r === "object" && !Array.isArray(r),
		);
	}
	if (parsed !== null && typeof parsed === "object") return [parsed as Rec];
	return null;
}

function csvField(v: unknown): string {
	const s = v == null ? "" : String(v);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `featureData` JSON (an array of records, columns in first-seen order —
 *  the same shape the DATA table shows) → RFC-4180 CSV. Non-record JSON
 *  → "" so the row is simply omitted. */
export function recordsToCsv(json: string): string {
	const records = parseRecords(json);
	if (!records || records.length === 0) return "";
	const cols: string[] = [];
	for (const r of records) {
		for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
	}
	if (cols.length === 0) return "";
	const lines = [cols.map(csvField).join(",")];
	for (const r of records)
		lines.push(cols.map((c) => csvField(r[c])).join(","));
	return lines.join("\n");
}

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += ch;
			}
		} else if (ch === '"') {
			quoted = true;
		} else if (ch === ",") {
			row.push(field);
			field = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += ch;
		}
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** A CSV cell back to the JSON value it came from. Only a canonical
 *  number round-trips as a number ("3" → 3, "1.7" → 1.7); "0123" and
 *  "1e5" stay strings, as does everything else. */
function cellValue(s: string): unknown {
	return s !== "" && String(Number(s)) === s ? Number(s) : s;
}

/** Inverse of `recordsToCsv`. Empty cells are absent keys, so a record
 *  that never had a column doesn't gain it. Returns null for a blank or
 *  header-only CSV. */
export function csvToRecordsJson(csv: string): string | null {
	const rows = parseCsv(csv.trim());
	if (rows.length < 2) return null;
	const cols = rows[0];
	const records: Rec[] = [];
	for (const cells of rows.slice(1)) {
		const r: Rec = {};
		cols.forEach((c, i) => {
			const cell = cells[i] ?? "";
			if (cell !== "") r[c] = cellValue(cell);
		});
		records.push(r);
	}
	return JSON.stringify(records);
}

// ── contactsData: JSON refs ⇄ lines ──────────────────────────────────

const ID_SEP = " · ";

/** `[{id, name}]` → one contact per line: `Name`, or `Name · id` when the
 *  person has a stable id. Malformed → "". */
export function contactsToLines(json: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return "";
	}
	if (!Array.isArray(parsed)) return "";
	const lines: string[] = [];
	for (const c of parsed) {
		if (c === null || typeof c !== "object") continue;
		const name = typeof c.name === "string" ? c.name.trim() : "";
		const id = typeof c.id === "string" ? c.id.trim() : "";
		if (!name && !id) continue;
		lines.push(id ? `${name}${ID_SEP}${id}` : name);
	}
	return lines.join("\n");
}

/** Inverse of `contactsToLines`. Returns null when no line names anyone. */
export function linesToContactsJson(text: string): string | null {
	const refs: { id: string; name: string }[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const at = line.lastIndexOf(ID_SEP);
		if (at === -1) {
			refs.push({ id: "", name: line });
		} else {
			refs.push({
				id: line.slice(at + ID_SEP.length).trim(),
				name: line.slice(0, at).trim(),
			});
		}
	}
	return refs.length > 0 ? JSON.stringify(refs) : null;
}
