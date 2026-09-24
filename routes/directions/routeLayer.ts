/**
 * The route on the map, one implementation for both maps. Draws above everything: the line
 * is the road at every zoom. Three states look different on purpose: live road solid blue,
 * remembered dashed blue, direct dotted amber (a heading, not a road).
 */

import type maplibregl from "maplibre-gl";
import type { Route } from "./routeContract";

export const ROUTE_LAYER_IDS = {
	src: "rt-route-geo",
	casing: "rt-route-casing",
	line: "rt-route-line",
} as const;

const ROUTE_BLUE = "#4a90d9";
const DIRECT_AMBER = "#c8763c";
const CASING = "#10243a";

const EMPTY: GeoJSON.FeatureCollection = {
	type: "FeatureCollection",
	features: [],
};

export interface RouteLayerHandle {
	(): void;
	/** null clears the line */
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
