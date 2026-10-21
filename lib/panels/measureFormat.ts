import { getLocale } from "$parent/src/lib/paraglide/runtime";

// Shared number formatting for on-map measurement readouts — used by BOTH the Snake Ruler (mapUi/SnakeRuler.svelte) and the line/piece draw tool (MapDrawControls); keep rounding conventions in sync so totals + subtotals round identically.

const num = (n: number, d = 0): string =>
    n.toLocaleString(getLocale(), { minimumFractionDigits: d, maximumFractionDigits: d });

/** Distance from km → "847 m" / "12.3 km" / "1,234 km" (see conventions above). */
export function formatMeasureDist(km: number): string {
    const m = km * 1000;
    if (m < 1000) return `${num(Math.round(m))} m`;
    return `${km >= 20 ? num(Math.round(km)) : num(km, 1)} km`;
}

/** Area from hectares → "0.42 ha" / "3.1 ha" / "156 ha" / "1,000 km²". */
export function formatHectares(ha: number): string {
    if (ha >= 100_000) return `${num(Math.round(ha / 100))} km²`;
    return `${ha >= 30 ? num(Math.round(ha)) : ha >= 1 ? num(ha, 1) : num(ha, 2)} ha`;
}
