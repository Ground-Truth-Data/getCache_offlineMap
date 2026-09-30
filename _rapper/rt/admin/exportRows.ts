// One source of truth for turning table rows into JSON/CSV/Markdown/SQL text,
// plus clipboard-write and file-download. Pure string-building except the two
// side-effect helpers at the bottom (copyText / downloadText).

export type Row = Record<string, unknown>;

// null/undefined become empty, not the literal word "null" leaking into a CSV.
function cellToScalar(v: unknown): string {
	if (v === null || v === undefined) return "";
	if (typeof v === "object") {
		try {
			return JSON.stringify(v);
		} catch {
			return String(v);
		}
	}
	return String(v);
}

// Re-keyed to the given column order so the output matches what's on screen.
export function rowsToJson(columns: string[], rows: Row[]): string {
	const shaped = rows.map((r) => {
		const o: Row = {};
		for (const c of columns) o[c] = r[c] ?? null;
		return o;
	});
	return JSON.stringify(shaped, null, 2);
}

// RFC-4180: quote only when the field contains a comma/quote/newline, doubling embedded quotes.
function csvField(s: string): string {
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

export function rowsToCsv(columns: string[], rows: Row[]): string {
	const head = columns.map(csvField).join(",");
	const body = rows
		.map((r) => columns.map((c) => csvField(cellToScalar(r[c]))).join(","))
		.join("\n");
	return body ? `${head}\n${body}` : head;
}

// Pipes/newlines escaped so they don't break the table shape.
function mdCell(v: unknown): string {
	return cellToScalar(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function rowsToMarkdown(columns: string[], rows: Row[]): string {
	const head = `| ${columns.join(" | ")} |`;
	const rule = `| ${columns.map(() => "---").join(" | ")} |`;
	const body = rows
		.map((r) => `| ${columns.map((c) => mdCell(r[c])).join(" | ")} |`)
		.join("\n");
	return body ? `${head}\n${rule}\n${body}` : `${head}\n${rule}`;
}

// Numbers/booleans render bare, null renders NULL, everything else single-quoted with quotes doubled.
function sqlLiteral(v: unknown): string {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number" && Number.isFinite(v)) return String(v);
	if (typeof v === "boolean") return v ? "true" : "false";
	const s = typeof v === "object" ? JSON.stringify(v) : String(v);
	return `'${s.replace(/'/g, "''")}'`;
}

export function rowsToSql(
	table: string,
	columns: string[],
	rows: Row[],
): string {
	const safeTable = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)
		? `"${table}"`
		: `"${table.replace(/"/g, "")}"`;
	const colList = columns.map((c) => `"${c}"`).join(", ");
	return rows
		.map(
			(r) =>
				`INSERT INTO ${safeTable} (${colList}) VALUES (${columns
					.map((c) => sqlLiteral(r[c]))
					.join(", ")});`,
		)
		.join("\n");
}

/** Resolves true only when the text actually landed, so a "copied ✓" flash never lies. */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (err) {
		console.warn("[copyText] clipboard write failed:", err);
		return false;
	}
}

export function downloadText(filename: string, text: string, mime: string) {
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Next tick so the click has committed to the download.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
