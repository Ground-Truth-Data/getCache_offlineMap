import {
	createPropertyExpression,
	latest,
} from "@maplibre/maplibre-gl-style-spec";
import { DARK, layers } from "@protomaps/basemaps";
import { describe, expect, it } from "vitest";
import {
	buildStyle,
	groundFlavor,
	PLANET,
	PLANET_FULL_Z,
	PLANET_GONE_Z,
} from "./style";

/**
 * Every landuse fill ships opaque and must STAY opaque — translucency doubles
 * the paint where polygons abut and draws a grid of seams across the map.
 */
const GROUND_LAYER = new Set<string>();

const OPACITY = /-opacity$/;

function at(
	value: unknown,
	layerType: string,
	key: string,
	zoom: number,
): number {
	const spec = (latest as unknown as Record<string, Record<string, unknown>>)[
		`paint_${layerType}`
	][key];
	const r = createPropertyExpression(value, spec as never);
	if (r.result !== "success")
		throw new Error(r.value.map((e) => e.message).join());
	return r.value.evaluate({ zoom }, {} as never) as number;
}

describe("planet fade", () => {
	const planet = buildStyle("http://x")
		.layers.filter((l) => "source" in l && l.source === PLANET)
		.map(
			(l) => l as { id: string; type: string; paint?: Record<string, unknown> },
		);

	/** Each layer's paint as the basemap library ships it, before this style edits it. */
	const own = new Map(
		layers(PLANET, DARK, { lang: "en" }).map((l) => [
			l.id,
			(l as { paint?: Record<string, unknown> }).paint ?? {},
		]),
	);

	it("every planet layer has an opacity that is 0 below PLANET_GONE_Z", () => {
		expect(planet.length).toBeGreaterThan(50);
		for (const l of planet) {
			const keys = Object.keys(l.paint ?? {}).filter((k) => OPACITY.test(k));
			expect(keys.length, `${l.type} layer without opacity`).toBeGreaterThan(0);
			for (const k of keys) {
				expect(at(l.paint?.[k], l.type, k, PLANET_GONE_Z - 1)).toBe(0);
				expect(at(l.paint?.[k], l.type, k, 2)).toBe(0);
			}
		}
	});

	it("is fully there from PLANET_FULL_Z, keeping each layer's own opacity", () => {
		const z = PLANET_FULL_Z + 2;
		for (const l of planet)
			for (const k of Object.keys(l.paint ?? {}).filter((kk) =>
				OPACITY.test(kk),
			)) {
				// deliberately replacing stock — its ramp is asserted below instead.
				if (GROUND_LAYER.has(l.id) && k === "fill-opacity") continue;
				expect(at(l.paint?.[k], l.type, k, z), `${l.id} ${k}`).toBeCloseTo(
					at(own.get(l.id)?.[k] ?? 1, l.type, k, z),
					6,
				);
			}
	});

	// Every paint expression must EVALUATE at every zoom the map can reach, not
	// just the ones a feature is visible at. A curve that folds down to zero
	// stops throws "Out of bounds" on the first frame below its own ramp and
	// takes the whole map with it — invisible to any test that only samples
	// where it expected the layer to show (13 Sep 2026, z2.59).
	it("every planet layer evaluates across the whole zoom range", () => {
		for (const l of planet)
			for (const k of Object.keys(l.paint ?? {}).filter((kk) =>
				OPACITY.test(kk),
			))
				for (const z of [0, 1, 2.59, 4, 6, 6.5, 7, 9, 11, 14, 18, 22])
					expect(
						() => at(l.paint?.[k], l.type, k, z),
						`${l.id} ${k} at z${z}`,
					).not.toThrow();
	});

	// A translucent fill doubles its paint wherever two polygons meet, so an
	// opaque layer turned translucent draws a seam along every shared edge —
	// which lands on tile boundaries and reads as a grid over the map.
	it("leaves every landuse fill but the wood one opaque", () => {
		const others = planet.filter(
			(l) =>
				l.id.startsWith("landuse_") && l.type === "fill" && !GROUND_LAYER.has(l.id),
		);
		expect(others.length).toBeGreaterThan(5);
		for (const l of others)
			expect(
				at(l.paint?.["fill-opacity"], l.type, "fill-opacity", PLANET_FULL_Z + 5),
				`${l.id} must keep its stock opacity`,
			).toBeCloseTo(
				at(own.get(l.id)?.["fill-opacity"] ?? 1, l.type, "fill-opacity", PLANET_FULL_Z + 5),
				6,
			);
	});

	// The ground must SEPARATE from bare earth, which stock DARK deliberately
	// does not do — every ground tone ships within ~10 luminance points of
	// `earth`, and that flatness is what read as "a void with lakes in it".
	it("lifts the ground clear of bare earth", () => {
		const lum = (h: string) => {
			const c = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
			return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
		};
		const flavor = groundFlavor({ ...DARK });
		const earth = lum(DARK.earth as string);
		for (const key of ["wood_a", "wood_b", "park_a", "park_b"])
			expect(
				Math.abs(lum(flavor[key] as string) - earth),
				`${key} must read as different ground`,
			).toBeGreaterThan(10);
	});

	// The stock style cross-fades _a→_b across a zoom. Different values there
	// make the ground drift colour as you move, which reads as a bug.
	it("keeps each _a/_b pair equal", () => {
		const flavor = groundFlavor({ ...DARK });
		for (const base of ["wood", "park", "scrub"])
			expect(flavor[`${base}_a`], `${base} must not drift`).toBe(
				flavor[`${base}_b`],
			);
	});

	// GROUND_LIFT 0 must be exactly stock, so the dial can always be turned off.
	it("returns stock colours when the lift is zero", () => {
		const zero = groundFlavor({ ...DARK }, 0);
		for (const key of ["wood_a", "park_b", "sand", "industrial"])
			expect(zero[key]).toBe(DARK[key]);
	});

	it("is halfway between the two", () => {
		const land = planet.find((l) => l.type === "fill");
		const mid = at(
			land?.paint?.["fill-opacity"],
			"fill",
			"fill-opacity",
			(PLANET_GONE_Z + PLANET_FULL_Z) / 2,
		);
		expect(mid).toBeGreaterThan(0.2);
		expect(mid).toBeLessThan(0.8);
	});
});
