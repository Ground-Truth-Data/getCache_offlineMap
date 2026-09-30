// Click-to-sort for the dashboard tables.
//
// Extracted from table/[table]/+page.svelte so the Analytics page sorts
// IDENTICALLY to the table viewer — same null handling, same numeric-vs-text
// rule, same asc/desc toggle. The table viewer keeps its own copy because it
// also carries column drag/resize state that doesn't generalise; this module
// is the portable core for the simpler tables.

export interface SortState {
	col: string;
	asc: boolean;
}

/**
 * Toggle rule: clicking the ACTIVE column flips direction; clicking a new
 * column selects it ascending. Matches the table viewer exactly.
 */
export function nextSort(current: SortState, col: string): SortState {
	if (current.col === col) return { col, asc: !current.asc };
	return { col, asc: true };
}

/**
 * Compare two cell values.
 *
 * NULLS ALWAYS LAST, in both directions — a column of mostly-blank cells
 * would otherwise bury the real data under empties when sorted descending,
 * which is the one behaviour that makes a sortable table useless.
 */
function compareValues(av: unknown, bv: unknown, asc: boolean): number {
	const an = av == null || av === "";
	const bn = bv == null || bv === "";
	if (an && bn) return 0;
	if (an) return 1;
	if (bn) return -1;

	let cmp: number;
	if (typeof av === "number" && typeof bv === "number") {
		cmp = av - bv;
	} else if (isIsoish(av) && isIsoish(bv)) {
		cmp = new Date(av as string).getTime() - new Date(bv as string).getTime();
	} else {
		cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
	}
	return asc ? cmp : -cmp;
}

// Timestamps arrive as ISO strings and must sort chronologically, not
// alphabetically. ISO-8601 happens to sort correctly as text, but only when
// both values are the same shape — parsing is the safe route.
function isIsoish(v: unknown): boolean {
	return typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]/.test(v);
}

/**
 * Sort a copy of `rows` by the value `pick` returns for the active column.
 * Returns the input untouched when no column is selected, so "unsorted" is
 * a real state (natural/server order) rather than an implicit default.
 */
export function sortRows<T>(
	rows: T[],
	sort: SortState,
	pick: (row: T, col: string) => unknown = (row, col) => (row as Record<string, unknown>)[col],
): T[] {
	if (!sort.col) return rows;
	return [...rows].sort((a, b) =>
		compareValues(pick(a, sort.col), pick(b, sort.col), sort.asc),
	);
}

/** Header indicator: ▲ / ▼ on the active column, ↕ on the rest. */
export function sortArrow(sort: SortState, col: string): string {
	if (sort.col !== col) return "↕";
	return sort.asc ? "▲" : "▼";
}
