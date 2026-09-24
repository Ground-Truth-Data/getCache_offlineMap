/**
 * The wall map's layer stack, bottom-first, in paint order. Per-pin satellite
 * photos are mounted by the page before SAT_INSERT_BEFORE.
 *
 * One disc source spans every stored zoom, so no zoom number belongs in a
 * road layer: hand-written bands leave tiles unpainted between windows.
 */

import type * as mapboxgl from "maplibre-gl";

import {
    PATH_LINE,
    RAIL_LINE,
    ROAD_LINE,
    ROAD_MAJOR_LINE,
    WATER_FILL,
    WATER_LINE,
} from "./offlineColors";
import { RAW_SOURCE, SHALLOW_SOURCE } from "../roads/rawWallProtocol";
import { BLOB_MIN_Z } from "../../contract/roadBlob";
import { BLOB_TILE_Z, SHALLOW_Z } from "../../contract/grid";
import { BLOB_GRID_SOURCE } from "./blobGrid";

/** The layer per-area satellite photos mount before: under roads, over water. */
export const SAT_INSERT_BEFORE = "v4-roads";

/** One width for every road kind; colour is the only hierarchy. */
const ROAD_WIDTH: mapboxgl.ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6,
    0.85,
    9,
    1.1,
    12,
    1.35,
    16,
    1.7,
];

/** Colour by `kind` only, never by `["zoom"]`: a road must be the same colour at every zoom. */
const ROAD_COLOR: mapboxgl.ExpressionSpecification = [
    "match",
    ["get", "kind"],
    ["major_road", "highway"],
    ROAD_MAJOR_LINE,
    ROAD_LINE,
];

/** Camera zoom from which minor roads draw. Below it RAM scales with the
 *  ground on screen: a carpet of discs at z9 cost 2.3 GB in the tile worker. */
const MINOR_ROAD_Z = 11;
/** Camera zoom from which water draws; half-level fade so lakes ease in. */
const WATER_Z = 10;
const WATER_FILL_OPACITY: mapboxgl.ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    WATER_Z,
    0,
    WATER_Z + 0.5,
    0.85,
];
const WATER_LINE_OPACITY: mapboxgl.ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    WATER_Z,
    0,
    WATER_Z + 0.5,
    1,
];
/** Small roads fade in over half a zoom level rather than snapping on. */
const MINOR_ROAD_OPACITY: mapboxgl.ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    MINOR_ROAD_Z,
    0,
    MINOR_ROAD_Z + 0.5,
    1,
];
const MINOR_ONLY: mapboxgl.FilterSpecification = [
    "==",
    ["get", "kind"],
    "minor_road",
];
const NOT_MINOR: mapboxgl.FilterSpecification = [
    "!=",
    ["get", "kind"],
    "minor_road",
];

const ROADS_ONLY: mapboxgl.FilterSpecification = [
    "match",
    ["get", "kind"],
    ["rail", "aeroway", "path"],
    false,
    true,
];

/**
 * The whole wall-map stack, bottom-first, in paint order.
 *
 * No `earth` fill: Protomaps' earth clips to z12 tile rectangles, so on the
 * download frontier it reads as dark blocks. The bundled coastline is the
 * figure-ground; roads may cross water.
 */
export function wallLayers(): mapboxgl.LayerSpecification[] {
    return [
        // Ghost grid: one white square per pin's tileset, visible only below the
        // disc floor. MapLibre clamps outside its stops, so two stops give all
        // three regimes.
        {
            id: "v4-blob-grid-fill",
            type: "fill",
            source: BLOB_GRID_SOURCE,
            paint: {
                "fill-color": "#ffffff",
                "fill-opacity": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    SHALLOW_Z,
                    0.01,
                    BLOB_TILE_Z - 0.1,
                    0,
                ],
            },
        } as mapboxgl.LayerSpecification,
        // Two water layers: the source-layer mixes polygons (lake) and lines
        // (river), and a line layer would outline every pond.
        {
            id: "v4-water-fill",
            type: "fill",
            source: RAW_SOURCE,
            "source-layer": "water",
            minzoom: WATER_Z,
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: {
                "fill-color": WATER_FILL,
                "fill-opacity": WATER_FILL_OPACITY,
            },
        } as mapboxgl.LayerSpecification,
        {
            id: "v4-water-line",
            type: "line",
            source: RAW_SOURCE,
            "source-layer": "water",
            minzoom: WATER_Z,
            filter: ["==", ["geometry-type"], "LineString"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": WATER_LINE,
                "line-opacity": WATER_LINE_OPACITY,
                "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    8,
                    0.6,
                    12,
                    1.2,
                    16,
                    2.4,
                ],
            },
        } as mapboxgl.LayerSpecification,

        // Shallow z6 tier keeps roads on screen below the disc floor, where the
        // disc is silent by contract; maxzoom = BLOB_MIN_Z hands over exactly there.
        {
            id: "v4-roads-shallow",
            type: "line",
            source: SHALLOW_SOURCE,
            "source-layer": "roads",
            minzoom: SHALLOW_Z,
            maxzoom: BLOB_MIN_Z,
            filter: ["all", ROADS_ONLY, NOT_MINOR],
            paint: { "line-color": ROAD_COLOR, "line-width": ROAD_WIDTH },
        } as mapboxgl.LayerSpecification,

        // No zoom window: the source's own span says which levels exist.
        {
            id: "v4-roads",
            type: "line",
            source: RAW_SOURCE,
            "source-layer": "roads",
            filter: ["all", ROADS_ONLY, NOT_MINOR],
            paint: { "line-color": ROAD_COLOR, "line-width": ROAD_WIDTH },
        } as mapboxgl.LayerSpecification,
        // Minor roads only inside a disc; the shallow tier never draws them.
        {
            id: "v4-roads-minor",
            type: "line",
            source: RAW_SOURCE,
            "source-layer": "roads",
            minzoom: MINOR_ROAD_Z,
            filter: MINOR_ONLY,
            paint: {
                "line-color": ROAD_COLOR,
                "line-width": ROAD_WIDTH,
                "line-opacity": MINOR_ROAD_OPACITY,
            },
        } as mapboxgl.LayerSpecification,

        // Dashed sage so a footpath reads as a trail, not a road.
        {
            id: "v4-path",
            type: "line",
            source: RAW_SOURCE,
            "source-layer": "roads",
            minzoom: MINOR_ROAD_Z,
            filter: ["==", ["get", "kind"], "path"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": PATH_LINE,
                "line-width": ROAD_WIDTH,
                "line-dasharray": [1.5, 1.5],
                "line-opacity": MINOR_ROAD_OPACITY,
            },
        } as mapboxgl.LayerSpecification,
        // Rail: a thin spine plus a wide second line whose dash is shorter than
        // its width, so each dash reads as a crosstie.
        {
            id: "v4-rail",
            type: "line",
            source: RAW_SOURCE,
            "source-layer": "roads",
            filter: ["==", ["get", "kind"], "rail"],
            layout: { "line-cap": "butt", "line-join": "round" },
            paint: {
                "line-color": RAIL_LINE,
                "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    6,
                    0.55,
                    12,
                    0.95,
                    16,
                    1.25,
                ],
            },
        } as mapboxgl.LayerSpecification,
        {
            id: "v4-rail-ties",
            type: "line",
            source: RAW_SOURCE,
            "source-layer": "roads",
            filter: ["==", ["get", "kind"], "rail"],
            layout: { "line-cap": "butt", "line-join": "round" },
            paint: {
                "line-color": RAIL_LINE,
                "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    6,
                    2.0,
                    12,
                    3.4,
                    16,
                    4.4,
                ],
                "line-dasharray": [0.3, 2.6],
            },
        } as mapboxgl.LayerSpecification,
    ];
}

/** Every layer id this module owns, derived so it cannot drift from the stack. */
export function wallLayerIds(): string[] {
    return wallLayers().map((l) => l.id);
}
