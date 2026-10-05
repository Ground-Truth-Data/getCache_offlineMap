<!-- The same four numbers on every Get Cache schema map, so the phone's
  database and Central's can be held side by side. -->
<script lang="ts">
import type { TableFill } from "./schemaBands";
import StatSide from "./StatSide.svelte";

let { tables }: { tables: TableFill[] } = $props();

const n = (v: number) => v.toLocaleString();
const pct = (of: number, total: number) => (total ? (of / total) * 100 : null);

const s = $derived.by(() => {
	const read = tables.filter((t) => !t.error);
	const cols = read.flatMap((t) => t.columns.map((c) => ({ rows: t.rows, filled: c.filled })));
	return {
		rows: read.reduce((a, t) => a + t.rows, 0),
		tables: read.length,
		tablesUsed: read.filter((t) => t.rows > 0).length,
		cols: cols.length,
		colsUsed: cols.filter((c) => c.filled > 0).length,
		cells: cols.reduce((a, c) => a + c.rows, 0),
		cellsFilled: cols.reduce((a, c) => a + c.filled, 0),
	};
});
const cellPct = $derived(pct(s.cellsFilled, s.cells));
</script>

<StatSide
	cells={[
		{ label: "Rows", value: n(s.rows), bar: null, head: true, sub: `across ${s.tables} tables` },
		{
			label: "Tables used",
			value: n(s.tablesUsed),
			unit: `/${s.tables}`,
			bar: pct(s.tablesUsed, s.tables),
			title: "Tables holding at least one row.",
		},
		{
			label: "Columns used",
			value: n(s.colsUsed),
			unit: `/${s.cols}`,
			bar: pct(s.colsUsed, s.cols),
			title: "Columns where at least one row holds something other than the default.",
		},
		{
			label: "Cells filled",
			value: cellPct === null ? "—" : `${Math.round(cellPct)}`,
			unit: "%",
			bar: cellPct,
			title: `${n(s.cellsFilled)} of ${n(s.cells)} cells hold something other than the default.`,
		},
	]}
/>
