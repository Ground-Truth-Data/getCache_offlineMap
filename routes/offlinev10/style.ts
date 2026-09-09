/**
 * The map style: Protomaps' stock dark basemap over the blobs (MIN_Z+), and a
 * few plain layers over the bundled Natural Earth pyramid everywhere else.
 * Both paint the same three tones so the handover at the border is invisible:
 * the pyramid's own opaque earth fill covers the world base inside the border,
 * so the border is a window — pyramid inside, world base outside — with no
 * fill of its own. The region is a gold line and nothing else.
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
/** A blob's photo goes under this planet layer: over the earth and landuse fills, under the water, the roads and every label. */
export const PHOTO_INSERT_BEFORE = "water";

/** Gold = commit, the app's own accent: the saved map's edge. */
const GOLD = "#f5a119";

/** The drawer's LEGEND card, in the shape MapLegend reads. */
export const LEGEND = [
	{ label: "Roads", color: DARK.major, swatch: "line" },
	{ label: "Lakes / rivers", color: DARK.water, swatch: "line" },
	{ label: "Boundaries", color: DARK.boundaries, swatch: "dashed" },
	{ label: "Saved map edge", color: GOLD, swatch: "line" },
] as const;

const BASE_TILES = "/mobileAssets/worldBase/base/tiles";
const GLYPHS = "/mobileAssets/worldBase/glyphs/{fontstack}/{range}.pbf";
const SPRITE = "/offlineV10/sprites/dark";
/** The one face bundled for airplane mode. Bold/italic map onto it. */
const FONT = "Noto Sans Regular";

function oneFont(layer: LayerSpecification): LayerSpecification {
	const layout = (layer as { layout?: Record<string, unknown> }).layout;
	if (layout && "text-font" in layout) layout["text-font"] = [FONT];
	return layer;
}

/**
 * Zoomed out, the planet's low tiles carry almost nothing — a highway or two —
 * while the world base underneath still draws its roads. So the planet is
 * invisible up to PLANET_GONE_Z and fully there from PLANET_FULL_Z; between
 * them the base shows through the fade. Its earth fill is what hides the base.
 */
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

/** One zoom curve per expression is the rule, so a layer's own curve is folded into the ramp: sampled at every stop of either, then multiplied. */
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

export function buildStyle(origin: string): StyleSpecification {
	const flavor = { ...DARK, regular: FONT, bold: FONT, italic: FONT };
	const planet = layers(PLANET, flavor, { lang: "en" })
		.filter((l) => l.type !== "background")
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
			id: "base-admin",
			type: "line",
			source: BASE,
			"source-layer": "admin",
			paint: {
				"line-color": DARK.boundaries,
				"line-width": 0.6,
				"line-dasharray": [3, 3],
			},
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

	// The border is the outside edge of the anchor tiles on disk — the exact
	// ground saved, at every zoom — and it is gone by BORDER_GONE_Z, before the
	// blob's own roads fill the screen.
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
