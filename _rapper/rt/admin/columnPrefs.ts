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
	let stored: unknown;
	try {
		if (!hasStorage()) return {};
		stored = JSON.parse(localStorage.getItem(storageKey(table)) ?? "{}");
	} catch {
		return {};
	}
	if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
	const { order, widths, fit } = stored as Record<string, unknown>;
	const prefs: ColumnPrefs = {};
	if (Array.isArray(order))
		prefs.order = order.filter((c): c is string => typeof c === "string");
	if (widths && typeof widths === "object" && !Array.isArray(widths))
		prefs.widths = Object.fromEntries(
			Object.entries(widths).filter(
				(e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] > 0,
			),
		);
	if (fit !== undefined) prefs.fit = fit as FitMode;
	return prefs;
}

export function saveColumnPrefs(table: string, prefs: ColumnPrefs): void {
	try {
		if (!hasStorage()) return;
		if (!hasPrefs(prefs)) localStorage.removeItem(storageKey(table));
		else localStorage.setItem(storageKey(table), JSON.stringify(prefs));
	} catch {
		// Quota or a blocked origin: the arrangement just isn't remembered.
	}
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

// Splitting on case as well as on `_`/`-`/space: these labels are column keys,
// and the two conventions sit side by side in one schema.
const wordsOf = (label: string) =>
	label
		.replace(/[_\-\s]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

const initialled = (words: string[], keep: number) => {
	if (words.length < 2) return words[0] ?? "";
	const last = words[words.length - 1];
	return `${words
		.slice(0, -1)
		.map((w) => w.slice(0, keep))
		.join("")}${last.charAt(0).toUpperCase()}${last.slice(1)}`;
};

/**
 * Fit's header text: every word but the last collapsed to its initial.
 *
 * A header in Fit is an IDENTIFIER, not a title. Spelling OrganizationTable's
 * 34 names needs 2.8 times the window Fit has to spend, so the names truncate
 * — and a stem shared by eight columns truncates to eight identical `sc…`,
 * which is a row nobody can map to its columns. Collapsing the stem puts the
 * letters that DIFFER where the truncation cannot reach them. The full name
 * stays one hover away, and the other two modes still spell it.
 *
 * The initials grow a letter at a time until no two collide, so a column set
 * this has never seen cannot be reduced to a duplicate by this function.
 */
export function fitLabels(labels: readonly string[]): string[] {
	const words = labels.map(wordsOf);
	const longest = Math.max(1, ...words.flat().map((w) => w.length));
	for (let keep = 1; keep < longest; keep++) {
		const out = words.map((w) => initialled(w, keep));
		if (new Set(out).size === out.length) return out;
	}
	return [...labels];
}

// Below this, a header is a letter and an ellipsis.
const MIN_DISTINCT = 2;

/**
 * Characters of each label that have to render for no two to read the same.
 *
 * A truncated header renders a PREFIX and an ellipsis, so two columns are
 * telling apart only as far as their prefixes differ.
 */
export function distinctChars(labels: readonly string[]): number[] {
	return labels.map((label, i) => {
		// A header down to one letter is unique and still unrecognisable, so the
		// count starts where a reader has something to recognise.
		for (let n = Math.min(MIN_DISTINCT, label.length); n < label.length; n++) {
			const head = label.slice(0, n);
			if (!labels.some((o, j) => j !== i && o.slice(0, n) === head)) return n;
		}
		return label.length;
	});
}

// A table crowded enough that its floors alone exceed the window still gets a
// tenth of it for content, and a table of two columns does not hand one column
// the whole window.
const MIN_CONTENT = 0.1;
const MAX_CONTENT = 0.8;

/**
 * Fit's column shares: a guaranteed part that keeps every header distinct, plus
 * a discretionary part that content bids for. Sums to 1.
 *
 * Fit is zero-sum — its shares are one window — so a weight here is what a
 * column is WORTH, not what it wants. Weighting by the longer of name and
 * content is right in Comfort, which has no fixed total, and wrong here: it
 * bought `scoreOrgFlag` width on the strength of a name it then truncated.
 *
 * How much is left to bid for is set by how crowded the table is, because the
 * floors come first: OrganizationTable's 34 headers need 85% of the window just
 * to stay apart, where StakeholderCategoryTable's five need 17%. `window` is
 * the width Fit ASSUMES, in the same unit as the floors — it decides the split
 * and nothing else. A narrower real window scales every share down together,
 * so the columns still sum to exactly one window, whatever it turns out to be.
 */
export function fitWeights(
	floors: readonly number[],
	bids: readonly number[],
	window: number,
): number[] {
	const floorTotal = floors.reduce((a, b) => a + b, 0) || 1;
	const bidTotal = bids.reduce((a, b) => a + b, 0);
	if (bidTotal === 0) return floors.map((f) => f / floorTotal);
	const content = Math.min(
		Math.max(1 - floorTotal / window, MIN_CONTENT),
		MAX_CONTENT,
	);
	return floors.map(
		(f, i) => (1 - content) * (f / floorTotal) + content * (bids[i] / bidTotal),
	);
}
