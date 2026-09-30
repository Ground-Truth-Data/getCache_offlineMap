<!--
  Every table of one SQLite database, one table at a time, named by the path
  after `base`. The database is the caller's: Get Cache's live OPFS file, or a
  `.sqlite3` dropped on admin — `all` is the only thing this reads through.
-->
<script module lang="ts">
export type SqlQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
	sql: string,
	params?: unknown[],
) => Promise<T[]>;
</script>

<script lang="ts">
import "./adminTable.css";
import type { Snippet } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import AdminDataTable from "./AdminDataTable.svelte";
import AdminPageHead from "./AdminPageHead.svelte";
import AdminPager from "./AdminPager.svelte";
import ColumnPicker from "./ColumnPicker.svelte";
import JsonPeek from "./JsonPeek.svelte";
import TableToolbar from "./TableToolbar.svelte";
import { hiddenFromParams, hiddenToParams, visibleColumns } from "./columnPrefs";
import type { Row as ExportRow } from "./exportRows";
import { recencyColumn } from "./recencyColumn";
import { type SortState, sortRows } from "./sortRows";
import { setTableCounts } from "./tableCounts.svelte";
import SearchInput from "$parent/siblings/getCache_OnlineMap/lib/components/SearchInput.svelte";

type Row = Record<string, unknown>;

let {
	base,
	all,
	name,
	sub,
	children,
}: {
	base: string;
	all: SqlQuery;
	/** The heading while no table is chosen. */
	name: string;
	sub: string;
	/** Rendered under the heading — the caller's warnings and buttons. */
	children?: Snippet;
} = $props();

const table = $derived(
	page.url.pathname.startsWith(`${base}/`)
		? decodeURIComponent(page.url.pathname.slice(base.length + 1))
		: null,
);

let rows = $state<Row[]>([]);
let columns = $state<string[]>([]);
let err = $state("");
let filter = $state("");
let sort = $state<SortState>({ col: "", asc: true });

const DEFAULT_PAGE_SIZE = 200;

// In the URL, not storage: a column set is a report, and a report is a link.
const hidden = $derived(hiddenFromParams(page.url.searchParams, columns));
const cols = $derived(visibleColumns(columns, hidden));

function setHidden(next: string[]) {
	const u = new URL(page.url);
	hiddenToParams(u.searchParams, next, columns);
	goto(u.pathname + u.search, {
		keepFocus: true,
		noScroll: true,
		replaceState: true,
	});
}

const matched = $derived.by(() => {
	const q = filter.trim().toLowerCase();
	const hit = !q
		? rows
		: rows.filter((r) =>
				Object.values(r).some((v) =>
					String(v ?? "")
						.toLowerCase()
						.includes(q),
				),
			);
	return sortRows(hit, sort, (r, c) => r[c]);
});

const pageSize = $derived(
	Math.max(1, Number(page.url.searchParams.get("size")) || DEFAULT_PAGE_SIZE),
);
const pageIndex = $derived(
	Math.max(0, Number(page.url.searchParams.get("page")) || 0),
);
const rowOffset = $derived(pageIndex * pageSize);
const shown = $derived(matched.slice(rowOffset, rowOffset + pageSize));

const pageHref = (n: number) => {
	const u = new URL(page.url);
	if (n <= 0) u.searchParams.delete("page");
	else u.searchParams.set("page", String(n));
	return u.pathname + u.search;
};

function setPageSize(size: number) {
	const u = new URL(page.url);
	u.searchParams.set("size", String(size));
	u.searchParams.delete("page");
	goto(u.pathname + u.search, { keepFocus: true, noScroll: true });
}

// Page 3 of the table is not page 3 of the matches.
function onFilter(v: string) {
	filter = v;
	if (pageIndex === 0) return;
	goto(pageHref(0), { keepFocus: true, noScroll: true, replaceState: true });
}

/**
 * Row count per table in one statement — one per table stalls a cold open. An
 * unreadable table is left out, never recorded as 0.
 */
async function tableCounts(): Promise<Record<string, number>> {
	const names = await all<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
	);
	if (names.length === 0) return {};
	const union = names
		.map((t) => `SELECT '${t.name}' AS t, COUNT(*) AS n FROM "${t.name}"`)
		.join(" UNION ALL ");
	const out: Record<string, number> = {};
	for (const r of await all<{ t: string; n: number }>(union)) out[r.t] = r.n;
	return out;
}

async function load(name: string) {
	// Identifiers cannot be bound, so the name is checked against the database.
	const known = await all<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
		[name],
	);
	if (known.length === 0) throw new Error(`No table "${name}" in this database`);
	// No LIMIT: the pager keeps the DOM small, and a LIMIT truncates in silence.
	// Columns come from the schema so an empty table still shows headers.
	// Both awaited before either is assigned, or new rows render against old
	// columns for one frame.
	const [nextRows, info] = await Promise.all([
		all(`SELECT * FROM "${name}"`),
		all<{ name: string }>(`PRAGMA table_info("${name}")`),
	]);
	rows = nextRows;
	columns = info.map((c) => c.name);
	// Keys belong to the table they were read from.
	ticked.clear();
	// There is no schema here for whatever table the URL names, so the recency
	// column is guessed.
	sort = { col: recencyColumn(columns), asc: false };
}

$effect(() => {
	tableCounts().then(setTableCounts, (e) => (err = String(e?.message ?? e)));
});

// `table` comes from the URL, so navigation is the trigger. replaceState would
// change the address without re-running this.
$effect(() => {
	const name = table;
	if (!name) return;
	err = "";
	filter = "";
	load(name).catch((e) => {
		rows = [];
		columns = [];
		err = String((e as Error)?.message ?? e);
	});
});

const totalLabel = $derived(matched.length.toLocaleString());

const countLine = $derived(
	filter.trim()
		? `${matched.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`
		: `${rows.length.toLocaleString()} rows`,
);

// A column is only as wide as its header, so long cells are cut off.
let peek = $state<{ col: string; pk: string; text?: string } | null>(null);

function peekCell(col: string, row: Row) {
	const v = fmt(row[col]);
	// fmt writes "—" for NULL, which answers nothing in a dialog.
	if (v === "" || v === "—") return;
	peek = { col, pk: rowKey(row), text: v };
}

// Identity comes from the row, never `columns`: they are filled one await
// apart, and a stale `columns[0]` makes every key "undefined". `SELECT *` puts
// the primary key at property 0.
const rowKey = (r: Row) => {
	const [first] = Object.keys(r);
	return first === undefined ? JSON.stringify(r) : String(r[first]);
};

const fmt = (v: unknown): string => {
	if (v === null || v === undefined) return "—";
	if (v instanceof Uint8Array) return `<${v.byteLength}B blob>`;
	return String(v);
};

// Held by key: `matched` is rebuilt on every sort, filter and page turn.
let ticked = $state(new SvelteSet<string>());

// Over the matches, not the page: paging must not untick what scrolled away.
const allTicked = $derived(
	matched.length > 0 && matched.every((r) => ticked.has(rowKey(r))),
);
const someTicked = $derived(!allTicked && ticked.size > 0);
const tickedRows = $derived(matched.filter((r) => ticked.has(rowKey(r))));

function tick(row: Row) {
	const k = rowKey(row);
	if (ticked.has(k)) ticked.delete(k);
	else ticked.add(k);
}

function tickAll() {
	if (allTicked) ticked.clear();
	else for (const r of matched) ticked.add(rowKey(r));
}
</script>

<svelte:head><title>{table ?? name} — Get Cache</title></svelte:head>

<div class="admin-shell">
<div class="admin-wrap">
	<AdminPageHead
		title={table ?? name}
		{sub}
		meta={table && !err ? countLine : undefined}
	>
		{#snippet search()}
			{#if table && !err}
				<SearchInput
					value={filter}
					placeholder="Search any column"
					oninput={(e) => onFilter((e.currentTarget as HTMLInputElement).value)}
				/>
				<ColumnPicker {columns} {hidden} onchange={setHidden} />
			{/if}
		{/snippet}
	</AdminPageHead>

	{@render children?.()}

	{#if err}
		<p class="warn">✗ {err}</p>
	{:else if !table}
		<p class="sub">Pick a table above.</p>
	{:else}
		<!-- Nothing ticked falls back to the matches, so Copy and Export answer
		     "this search". -->
		<TableToolbar
			columns={cols}
			filteredRows={matched as ExportRow[]}
			selectedRows={tickedRows as ExportRow[]}
			tableName={table}
		/>

		<AdminDataTable
			columns={cols}
			rows={shown}
			{rowKey}
			{sort}
			onSort={(next) => (sort = next)}
			frozen={3}
			rowNumberOffset={rowOffset}
			totalLabel={totalLabel}
			onPeek={peekCell}
			render={(c, r) => fmt(r[c])}
			cellTitle={(c, r) => fmt(r[c])}
			rowClass={(r) => (ticked.has(rowKey(r)) ? "row-selected" : "")}
		>
			<!-- `null` is the header's tick. -->
			{#snippet lead(row)}
				{#if row === null}
					<input
						type="checkbox"
						checked={allTicked}
						indeterminate={someTicked}
						onchange={tickAll}
						aria-label="Select all matching rows"
					/>
				{:else}
					<input
						type="checkbox"
						checked={ticked.has(rowKey(row))}
						onchange={() => tick(row)}
						aria-label="Select row"
					/>
				{/if}
			{/snippet}
		</AdminDataTable>

		<AdminPager
			page={pageIndex}
			{pageSize}
			rowsOnPage={shown.length}
			total={matched.length}
			hasMore={rowOffset + shown.length < matched.length}
			href={pageHref}
			onPageSize={setPageSize}
		/>
	{/if}
</div>
</div>

<!-- `endpoint` is unused: every peek carries its own text. -->
<JsonPeek endpoint="" open={peek} onclose={() => (peek = null)} />

<style>
.sub { color: #777; font-size: 0.8rem; margin: 0.25rem 0 0; }
.warn { color: #e0b24a; font-size: 0.85rem; margin: 0.5rem 0 1rem; }
</style>
