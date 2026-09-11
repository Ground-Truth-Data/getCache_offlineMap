/**
 * routeLayer — the route on the map, ONE implementation for both maps (online
 * Mapbox, offline MapLibre), like the hospital and fire layers.
 *
 * It draws ABOVE everything: the whole point of the line is that it is visible
 * zoomed out, where the forestry road under it is not (small roads only draw
 * from MINOR_ROAD_Z, because drawing them everywhere cost 2.3 GB of RAM). The
 * line is the road, at every zoom.
 *
 * ⚠️ THE THREE STATES LOOK DIFFERENT, ON PURPOSE.
 *   live road     — solid blue, the line you just asked for
 *   remembered    — dashed blue, so a snapshot can never be mistaken for live
 *   direct        — dotted amber, a HEADING and not a road; it does not follow
 *                   any ground and must never read as though it does
 * Making these one colour would be prettier and is exactly the bug.
 */

import type maplibregl from "maplibre-gl";
import type { Route } from "./routeContract";

export const ROUTE_LAYER_IDS = {
	src: "rt-route-geo",
	casing: "rt-route-casing",
	line: "rt-route-line",
} as const;

/** Google's blue, near enough: the colour a driver already reads as "the way". */
const ROUTE_BLUE = "#4a90d9";
/** Terracotta = context, the app's second accent — a heading, not a road. */
const DIRECT_AMBER = "#c8763c";
/** Under the line, so it stands off dark tiles and satellite alike. */
const CASING = "#10243a";

const EMPTY: GeoJSON.FeatureCollection = {
	type: "FeatureCollection",
	features: [],
};

export interface RouteLayerHandle {
	(): void;
	/** Show this route, in the paint its state earns. Null clears the line. */
	show: (route: Route | null, live: boolean) => void;
}

function collection(route: Route | null): GeoJSON.FeatureCollection {
	if (!route) return EMPTY;
	return {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				geometry: { type: "LineString", coordinates: route.coordinates },
				properties: { kind: route.kind },
			},
		],
	};
}

/** Dash pattern for the three states — the shape of the line IS the honesty. */
export function dashFor(
	route: Route | null,
	live: boolean,
): number[] | undefined {
	if (!route) return undefined;
	if (route.kind === "direct") return [0.5, 2];
	return live ? undefined : [2, 1.5];
}

export function colorFor(route: Route | null): string {
	return route?.kind === "direct" ? DIRECT_AMBER : ROUTE_BLUE;
}

export function addRouteLayer(map: maplibregl.Map): RouteLayerHandle {
	if (!map.getSource(ROUTE_LAYER_IDS.src))
		map.addSource(ROUTE_LAYER_IDS.src, { type: "geojson", data: EMPTY });

	const width: maplibregl.ExpressionSpecification = [
		"interpolate",
		["linear"],
		["zoom"],
		// Zoomed out this is the ONLY thing showing the road, so it stays
		// readable at a glance rather than scaling to nothing.
		5,
		3,
		12,
		5.5,
	];

	if (!map.getLayer(ROUTE_LAYER_IDS.casing))
		map.addLayer({
			id: ROUTE_LAYER_IDS.casing,
			type: "line",
			source: ROUTE_LAYER_IDS.src,
			layout: { "line-cap": "round", "line-join": "round" },
			paint: {
				"line-color": CASING,
				"line-width": ["+", width, 3],
				"line-opacity": 0.9,
			},
		});

	if (!map.getLayer(ROUTE_LAYER_IDS.line))
		map.addLayer({
			id: ROUTE_LAYER_IDS.line,
			type: "line",
			source: ROUTE_LAYER_IDS.src,
			layout: { "line-cap": "round", "line-join": "round" },
			paint: { "line-color": ROUTE_BLUE, "line-width": width },
		});

	const handle = (() => {
		for (const id of [ROUTE_LAYER_IDS.line, ROUTE_LAYER_IDS.casing])
			if (map.getLayer(id)) map.removeLayer(id);
		if (map.getSource(ROUTE_LAYER_IDS.src))
			map.removeSource(ROUTE_LAYER_IDS.src);
	}) as RouteLayerHandle;

	handle.show = (route, live) => {
		const src = map.getSource(ROUTE_LAYER_IDS.src) as
			| maplibregl.GeoJSONSource
			| undefined;
		src?.setData(collection(route));
		if (!map.getLayer(ROUTE_LAYER_IDS.line)) return;
		map.setPaintProperty(
			ROUTE_LAYER_IDS.line,
			"line-color",
			colorFor(route),
		);
		const dash = dashFor(route, live);
		map.setPaintProperty(
			ROUTE_LAYER_IDS.line,
			"line-dasharray",
			dash ?? [1],
		);
	};

	return handle;
}
