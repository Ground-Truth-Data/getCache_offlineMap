// Prefs are keyed by table name only, so the IndexedDB and GC Supabase
// viewers share one arrangement per table.

// Not $app/environment, so the module stays importable outside SvelteKit.
const hasStorage = () => typeof localStorage !== "undefined";

/**
 * How a table spends the window's width.
 *
 * One width rule cannot serve a six-column table and a 33-column one, so the
 * table is told which question is being asked: `comfort` fits content under a
 * cap, `fit` shares one window across every column, `full` renders every value
 * whole and scrolls.
 */
export type FitMode = "comfort" | "fit" | "full";
export const FIT_MODES: readonly FitMode[] = ["comfort", "fit", "full"];
/** A table nobody has touched behaves as it always did. */
export const DEFAULT_FIT: FitMode = "comfort";

// Which columns are SHOWN lives in the URL, not here — see `hiddenFromParams`.
export type ColumnPrefs = {
	order?: string[];
	widths?: Record<string, number>;
	fit?: FitMode;
};

/** The saved mode, or the default. A mode this build no longer has is not one. */
export function fitMode(prefs: ColumnPrefs): FitMode {
	const saved = prefs.fit;
	return saved !== undefined && FIT_MODES.includes(saved) ? saved : DEFAULT_FIT;
}

const storageKey = (table: string) => `rtAdminCols:${table}`;

export function loadColumnPrefs(table: string): ColumnPrefs {
	if (!hasStorage()) return {};
	try {
		return JSON.parse(
			localStorage.getItem(storageKey(table)) ?? "{}",
		) as ColumnPrefs;
	} catch {
		return {};
	}
}

export function saveColumnPrefs(table: string, prefs: ColumnPrefs): void {
	if (!hasStorage()) return;
	if (!hasPrefs(prefs)) localStorage.removeItem(storageKey(table));
	else localStorage.setItem(storageKey(table), JSON.stringify(prefs));
}

function hasPrefs(prefs: ColumnPrefs): boolean {
	return (
		(prefs.order?.length ?? 0) > 0 ||
		Object.keys(prefs.widths ?? {}).length > 0 ||
		// Stored even when it equals the default: what is worth keeping is that
		// this table was answered for, not which answer won.
		prefs.fit !== undefined
	);
}

// A column choice IS a report ("orgs with their scores") and has to be a
// link: sendable, bookmarkable, the same on another machine — so it rides in
// the query string, not localStorage. Order and widths stay in localStorage:
// those are fiddling, not a report.
const HIDE_PARAM = "hide";
// The other spelling, for the narrow case. See `hiddenToParams`.
const SHOW_PARAM = "cols";

/**
 * The columns hidden by a URL, or undefined when it says nothing.
 *
 * The param names what is OFF, not what is on — so a new column appears in
 * every old report automatically, instead of `?cols=a,b,c` freezing a report
 * at three columns forever.
 *
 * Absent or empty means every column.
 */
export function hiddenFromParams(
	params: URLSearchParams,
	columns: string[],
): string[] {
	const names = (raw: string) =>
		raw
			.split(",")
			.map((c) => c.trim())
			.filter(Boolean);

	// `?cols=` is a CLOSED report; read first so a link carrying both is
	// unambiguous.
	const show = params.get(SHOW_PARAM);
	if (show) {
		const wanted = new Set(names(show));
		return columns.filter((c) => !wanted.has(c));
	}

	const raw = params.get(HIDE_PARAM);
	if (!raw) return [];
	// A stale/typo'd name is dropped rather than carried through copied links.
	const known = new Set(columns);
	return names(raw).filter((c) => known.has(c));
}

/**
 * Write the column choice, in whichever of the two spellings is shorter.
 *
 * `?hide=` is the default and stays live as the schema grows. But picking 5
 * of 32 columns writes the 27 you didn't pick — long enough to wrap and break
 * in mail/chat clients — so a choice that hides MORE than half is written the
 * other way, as `?cols=` naming what to show. That form is deliberately
 * CLOSED: it won't pick up columns added later. Every column writes no param.
 */
export function hiddenToParams(
	params: URLSearchParams,
	hidden: string[],
	columns: string[],
): URLSearchParams {
	params.delete(HIDE_PARAM);
	params.delete(SHOW_PARAM);
	if (hidden.length === 0) return params;

	const shown = columns.filter((c) => !hidden.includes(c));
	if (shown.length < hidden.length) params.set(SHOW_PARAM, shown.join(","));
	else params.set(HIDE_PARAM, hidden.join(","));
	return params;
}

/**
 * The columns to render: the ordered list minus whatever is switched off.
 *
 * Never empty — the picker that restores a column is reached from the header
 * itself, so the first column survives any denylist.
 */
export function visibleColumns(cols: string[], hidden: string[]): string[] {
	const off = new Set(hidden);
	const shown = cols.filter((c) => !off.has(c));
	return shown.length > 0 ? shown : cols.slice(0, 1);
}

/** Flip one column, returning the next hidden set. */
export function toggleColumn(hidden: string[], col: string): string[] {
	const off = new Set(hidden);
	if (off.has(col)) off.delete(col);
	else off.add(col);
	return [...off];
}

// A column the saved pref doesn't know (e.g. a schema addition) is inserted
// after its nearest preceding default-order neighbour that IS placed.
export function applyColumnOrder(
	defaultCols: string[],
	saved?: string[],
): string[] {
	if (!saved || saved.length === 0) return [...new Set(defaultCols)];
	// De-duped: a repeated name renders as two columns with one key, which
	// kills the keyed {#each} and blanks the whole table.
	const known = new Set(defaultCols);
	const placed = [...new Set(saved)].filter((c) => known.has(c));
	for (let i = 0; i < defaultCols.length; i++) {
		const col = defaultCols[i];
		if (placed.includes(col)) continue;
		let at = 0;
		for (let j = i - 1; j >= 0; j--) {
			const idx = placed.indexOf(defaultCols[j]);
			if (idx >= 0) {
				at = idx + 1;
				break;
			}
		}
		placed.splice(at, 0, col);
	}
	return placed;
}

// Dragging rightward lands after `target`, leftward lands before it.
export function moveColumn(
	cols: string[],
	col: string,
	target: string,
): string[] {
	const from = cols.indexOf(col);
	const to = cols.indexOf(target);
	if (from < 0 || to < 0 || from === to) return cols;
	const next = cols.filter((c) => c !== col);
	next.splice(to, 0, col);
	return next;
}

// Beats the mode's max-width cap. Undefined → the mode's own width applies.
export function widthStyle(
	prefs: ColumnPrefs,
	col: string,
): string | undefined {
	const w = prefs.widths?.[col];
	return w ? `width:${w}px;min-width:${w}px;max-width:${w}px` : undefined;
}
