/**
 * Protomaps' stock dark basemap over the blobs, a few plain layers over the bundled
 * Natural Earth pyramid everywhere else, in the same tones so the handover is invisible.
 * The region is a gold line and nothing else.
 */

import { DARK, layers } from "@protomaps/basemaps";
import type {
	ExpressionSpecification,
	LayerSpecification,
	StyleSpecification,
} from "maplibre-gl";
import { PLANET_TILES } from "./protocol";
import { ANCHOR_Z, MAX_Z, MIN_Z } from "./tiles";

export const PLANET = "planet";
export const BASE = "world-base";
export const REGIONS = "v10-regions";
/** A blob's photo sits over the earth and landuse fills, under water, roads and labels. */
export const PHOTO_INSERT_BEFORE = "water";

const GOLD = "#f5a119";

// Zoomed in, stock slate water sits at the same value as the road greys, so a creek reads as a track; it turns blue over a zoom span.
const WATER_FAR = DARK.water;
const WATER_NEAR = "#2B3855";
const WATER_SHIFT_Z = 4;
const WATER_SHIFT_SPAN = 9;
const waterColor: ExpressionSpecification = [
	"interpolate",
	["linear"],
	["zoom"],
	WATER_SHIFT_Z,
	WATER_FAR,
	WATER_SHIFT_Z + WATER_SHIFT_SPAN,
	WATER_NEAR,
];

export const LEGEND = [
	{ label: "Roads", color: DARK.major, swatch: "line" },
	{ label: "Lakes / rivers", color: DARK.water, swatch: "line" },
	{ label: "Saved map edge", color: GOLD, swatch: "line" },
] as const;

const BASE_TILES = "/mobileAssets/worldBase/base/tiles";
const GLYPHS = "/mobileAssets/worldBase/glyphs/{fontstack}/{range}.pbf";
const SPRITE = "/offlineV10/sprites/dark";
/** The one face bundled for airplane mode; bold/italic map onto it. */
const FONT = "Noto Sans Regular";

function oneFont(layer: LayerSpecification): LayerSpecification {
	const layout = (layer as { layout?: Record<string, unknown> }).layout;
	if (layout && "text-font" in layout) layout["text-font"] = [FONT];
	return layer;
}

// The planet's low tiles carry almost nothing, so the world base shows through until the planet fades in.
export const PLANET_GONE_Z = 6;
export const PLANET_FULL_Z = 7;
const OPACITY_KEYS: Partial<Record<LayerSpecification["type"], string[]>> = {
	fill: ["fill-opacity"],
	line: ["line-opacity"],
	symbol: ["text-opacity", "icon-opacity"],
	circle: ["circle-opacity", "circle-stroke-opacity"],
	"fill-extrusion": ["fill-extrusion-opacity"],
};

type Stops = Array<[number, number]>;
const RAMP: Stops = [
	[PLANET_GONE_Z, 0],
	[PLANET_FULL_Z, 1],
];

function stopsOf(v: unknown): Stops | null {
	if (
		!Array.isArray(v) ||
		v[0] !== "interpolate" ||
		JSON.stringify(v[2]) !== '["zoom"]'
	)
		return null;
	const out: Stops = [];
	for (let i = 3; i < v.length; i += 2) {
		if (typeof v[i] !== "number" || typeof v[i + 1] !== "number") return null;
		out.push([v[i], v[i + 1]]);
	}
	return out;
}

function valueAt(stops: Stops, z: number): number {
	if (z <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		const [z0, v0] = stops[i - 1];
		const [z1, v1] = stops[i];
		if (z <= z1) return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
	}
	return stops[stops.length - 1][1];
}

/** One zoom curve per expression, so a layer's own curve is sampled at every stop of either and multiplied into the ramp. */
function foldRamp(own: unknown): ExpressionSpecification {
	const base = typeof own === "number" ? ([[0, own]] as Stops) : stopsOf(own);
	const stops = base ?? ([[0, 1]] as Stops);
	const zs = [...new Set([...RAMP, ...stops].map(([z]) => z))].sort(
		(a, b) => a - b,
	);
	const expr: unknown[] = ["interpolate", ["linear"], ["zoom"]];
	for (const z of zs) expr.push(z, valueAt(stops, z) * valueAt(RAMP, z));
	return expr as ExpressionSpecification;
}

function fadeIn(layer: LayerSpecification): LayerSpecification {
	const l = layer as { paint?: Record<string, unknown> };
	const paint = l.paint ?? {};
	l.paint = paint;
	for (const key of OPACITY_KEYS[layer.type] ?? [])
		paint[key] = foldRamp(paint[key]);
	return layer;
}

/**
 * Style the ground by overriding flavor colours, never by patching layers per kind.
 * Stock DARK hides the ground (every tone within 10 luminance points of `earth`); these lift only the ground keys.
 * Keep each `_a`/`_b` pair EQUAL: the stock style cross-fades between them across a zoom.
 * GROUND_LIFT: 0 = stock DARK, 1 = the values below. To restyle the whole map, swap the flavor in buildStyle.
 */
export const GROUND_LIFT = 1;
const GROUND: Record<string, string> = {
	wood_a: "#26312a",
	wood_b: "#26312a",
	park_a: "#24302b",
	park_b: "#24302b",
	scrub_a: "#2a3029",
	scrub_b: "#2a3029",
	sand: "#2b2924",
	beach: "#2d2b25",
	glacier: "#2a2c2e",
	industrial: "#232323",
	hospital: "#272425",
	school: "#252426",
	zoo: "#253029",
	military: "#282725",
	aerodrome: "#222222",
	pedestrian: "#242424",
};

export function groundFlavor<T extends Record<string, unknown>>(
	flavor: T,
	lift: number = GROUND_LIFT,
): T {
	const t = Math.max(0, Math.min(1, lift));
	const chan = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
	const out: Record<string, unknown> = { ...flavor };
	for (const [key, lifted] of Object.entries(GROUND)) {
		const stock = flavor[key];
		if (typeof stock !== "string" || !/^#[0-9a-f]{6}$/i.test(stock)) continue;
		out[key] =
			"#" +
			[0, 1, 2]
				.map((i) =>
					Math.round(chan(stock, i) + (chan(lifted, i) - chan(stock, i)) * t)
						.toString(16)
						.padStart(2, "0"),
				)
				.join("");
	}
	return out as T;
}

export function buildStyle(origin: string): StyleSpecification {
	const flavor = groundFlavor({ ...DARK, regular: FONT, bold: FONT, italic: FONT });
	const planet = layers(PLANET, flavor, { lang: "en" })
		.filter((l) => l.type !== "background")
		// Admin borders read as roads on a dark basemap.
		.filter((l) => (l as { "source-layer"?: string })["source-layer"] !== "boundaries")
		.map((l) => {
			if ((l as { "source-layer"?: string })["source-layer"] !== "water") return l;
			if (l.type !== "fill" && l.type !== "line") return l;
			const paint = (l as { paint?: Record<string, unknown> }).paint ?? {};
			paint[l.type === "fill" ? "fill-color" : "line-color"] = waterColor;
			(l as { paint?: Record<string, unknown> }).paint = paint;
			return l;
		})
		.map(oneFont)
		.map(fadeIn);

	const base: LayerSpecification[] = [
		{
			id: "bg",
			type: "background",
			paint: { "background-color": DARK.background },
		},
		{
			id: "base-land",
			type: "fill",
			source: BASE,
			"source-layer": "land",
			paint: { "fill-color": DARK.earth },
		},
		{
			id: "base-lakes",
			type: "fill",
			source: BASE,
			"source-layer": "lakes",
			paint: { "fill-color": DARK.water },
		},
		{
			id: "base-roads",
			type: "line",
			source: BASE,
			"source-layer": "roads",
			filter: [">=", ["zoom"], ["-", ["coalesce", ["get", "min_zoom"], 9], 4]],
			paint: {
				"line-color": DARK.major,
				"line-width": [
					"interpolate",
					["linear"],
					["zoom"],
					4,
					["match", ["get", "expressway"], 1, 1.2, 0.8],
					9,
					["match", ["get", "expressway"], 1, 2, 1.2],
				],
			},
		},
		{
			id: "base-rivers",
			type: "line",
			source: BASE,
			"source-layer": "rivers",
			paint: { "line-color": DARK.water, "line-width": 0.8 },
		},
		{
			id: "base-places",
			type: "symbol",
			source: BASE,
			"source-layer": "places",
			maxzoom: ANCHOR_Z,
			layout: {
				"text-field": ["get", "n"],
				"text-font": [FONT],
				"text-size": 11,
			},
			paint: {
				"text-color": DARK.city_label,
				"text-halo-color": DARK.city_label_halo,
				"text-halo-width": 1,
			},
		},
	];

	// The border is gone before the blob's own roads fill the screen.
	const BORDER_GONE_Z = 9;
	const fade = (hi: number): ExpressionSpecification => [
		"interpolate",
		["linear"],
		["zoom"],
		BORDER_GONE_Z - 1,
		hi,
		BORDER_GONE_Z,
		0,
	];
	const regions: LayerSpecification[] = [
		{
			id: "regions-line",
			type: "line",
			source: REGIONS,
			paint: {
				"line-color": GOLD,
				"line-opacity": fade(0.85),
				"line-width": 0.5,
			},
		},
	];

	return {
		version: 8,
		glyphs: origin + GLYPHS,
		sprite: origin + SPRITE,
		sources: {
			[BASE]: {
				type: "vector",
				tiles: [`${origin}${BASE_TILES}/{z}/{x}/{y}.pbf`],
				minzoom: 0,
				maxzoom: 6,
			},
			[PLANET]: {
				type: "vector",
				tiles: [PLANET_TILES],
				minzoom: MIN_Z,
				maxzoom: MAX_Z,
			},
			[REGIONS]: {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			},
		},
		layers: [...base, ...planet, ...regions],
	};
}
