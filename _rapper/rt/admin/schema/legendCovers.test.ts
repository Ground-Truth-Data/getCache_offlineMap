import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** A band the canvas paints but the legend never names looks like a complete legend. */
const here = new URL(".", import.meta.url).pathname;
const canvas = readFileSync(`${here}SchemaCanvas.svelte`, "utf8");
const legend = readFileSync(`${here}SchemaLegend.svelte`, "utf8");

function paintedClasses(css: string): string[] {
	return [...css.matchAll(/^\t*\.(?:card\.)?band-([a-z-]+)\s*\{/gm)].map(
		(m) => m[1],
	);
}

describe("the legend covers the canvas", () => {
	// No exemptions: a painted band is a named band.
	it("names every cell band the canvas paints", () => {
		const bands = legend.match(/const LEGEND = \[([\s\S]*?)\] as const;/)?.[1];
		expect(bands).toBeDefined();
		for (const band of new Set(paintedClasses(canvas))) {
			expect(bands, `no legend entry for band ${band}`).toContain(
				`"${band}"`,
			);
		}
	});

	/** An empty table's rows are ordinary empties; the card may style only itself. */
	it("gives an empty card no say over what is inside it", () => {
		const offenders = [
			...canvas.matchAll(/^\t*\.card\.empty\s+\S[^{]*\{/gm),
		].map((m) => m[0].trim());
		expect(offenders, "an empty card must style only itself").toEqual([]);
	});

	// Its rows already carry the yellow; a fill would say it twice.
	it("flags an empty table with a ring, never a fill", () => {
		const rule = canvas.match(/\.card\.empty\s*\{([\s\S]*?)\}/)?.[1] ?? "";
		expect(rule, "no .card.empty rule").not.toBe("");
		expect(rule).not.toMatch(/^\s*background(-color)?:/m);
	});

	// The card tint is not a Band, so it cannot ride BAND_LABEL.
	it("names the whole-card tint", () => {
		expect(legend).toContain('cls: "card-empty"');
		expect(legend).toContain(".sw.card-empty");
	});

	it("rings an empty card in red", () => {
		const rule = canvas.match(/\.card\.empty\s*\{[\s\S]*?\}/)?.[0] ?? "";
		expect(rule).toContain("224 90 72");
	});

	// A transparent band IS black on this page's near-black ground.
	it("paints no band transparent", () => {
		expect(canvas).not.toMatch(/\.band-[a-z-]+\s*\{[^}]*background:\s*transparent/);
	});
});
