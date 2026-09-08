import {
	createPropertyExpression,
	latest,
} from "@maplibre/maplibre-gl-style-spec";
import { DARK, layers } from "@protomaps/basemaps";
import { describe, expect, it } from "vitest";
import { buildStyle, PLANET, PLANET_FULL_Z, PLANET_GONE_Z } from "./style";

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
		const own = new Map(
			layers(PLANET, DARK, { lang: "en" }).map((l) => [
				l.id,
				(l as { paint?: Record<string, unknown> }).paint ?? {},
			]),
		);
		const z = PLANET_FULL_Z + 2;
		for (const l of planet)
			for (const k of Object.keys(l.paint ?? {}).filter((kk) =>
				OPACITY.test(kk),
			))
				expect(at(l.paint?.[k], l.type, k, z), `${l.id} ${k}`).toBeCloseTo(
					at(own.get(l.id)?.[k] ?? 1, l.type, k, z),
					6,
				);
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
