/** The layer toggles and the read-only colour key. Keep in sync with wallStyle.ts / wallLabels.ts. */

import {
    PATH_LINE,
    RAIL_LINE,
    ROAD_LINE,
    ROAD_MAJOR_LINE,
} from "./offlineColors";
import type { PackRead } from "../../contract/packLayers";

export interface LayerToggle {
    readonly key: string;
    readonly label: string;
    readonly ids: readonly string[];
    /** The draw mechanism, not the content: "cluster" and "pyramid" fail differently. */
    readonly hint?: string;
    /** The circuit key in workMeter.svelte.ts. */
    readonly feed?: "sat" | "pack" | "fires";
    /** What this layer reads from the pack; must match the filters in wallStyle.ts / wallLabels.ts. */
    readonly reads?: readonly PackRead[];
}

/** `sat`'s id is a stand-in: per-pin photo layers are `v4-sat-<key>-l`, swept by prefix. */
export const LAYER_TOGGLES: readonly LayerToggle[] = [
    {
        key: "sat",
        label: "Satellite",
        ids: ["v4-sat"],
        hint: "always on",
        feed: "sat",
    },
    {
        key: "vector",
        label: "Roads/water",
        ids: [
            "v4-water-fill",
            "v4-water-line",
            "v4-roads-shallow",
            "v4-roads",
            "v4-path",
            "v4-rail",
            "v4-rail-ties",
        ],
        hint: "always on",
        feed: "pack",
        reads: [
            { layer: "roads" },
            { layer: "water", kinds: ["water", "lake", "river", "canal"] },
        ],
    },
    {
        key: "labels",
        label: "Labels",
        ids: ["v4-town-label", "v4-road-label"],
        hint: "pyramid",
        feed: "pack",
        reads: [
            // kind_detail: every places feature is kind:locality
            {
                layer: "places",
                key: "kind_detail",
                kinds: ["city", "town", "village", "hamlet"],
            },
            { layer: "roads" },
        ],
    },
    // Ordered by what is looked at first in the field, not by mechanism.
    {
        key: "camps",
        label: "Places",
        ids: ["v4-poi-camp"],
        hint: "cluster",
        feed: "pack",
        reads: [{ layer: "pois", kinds: ["camp_site"] }],
    },
    {
        key: "hospitals",
        label: "Hospitals",
        ids: ["v4-poi-hospital"],
        hint: "pyramid",
        feed: "pack",
        reads: [{ layer: "pois", kinds: ["hospital"] }],
    },
    // Added by attachFireLayer() on map ready, so not in wallStyle.ts.
    {
        key: "fires",
        label: "Fires",
        ids: [
            "v4-fire-cluster",
            "v4-fire-cluster-count",
            "v4-fire-flame-single",
            "v4-fire-outline",
        ],
        hint: "cluster",
        feed: "fires",
    },
] as const;

/** Toggle keys `resetLayersAllOn()` must not force back on. */
export const OPT_IN_LAYERS: readonly string[] = [];

export interface LegendEntry {
    label: string;
    color: string;
    swatch: "line" | "dashed" | "fill" | "rail";
}

/** Only what this map actually paints. */
export const LEGEND: readonly LegendEntry[] = [
    { label: "Roads", color: ROAD_LINE, swatch: "line" },
    { label: "Major roads / highways", color: ROAD_MAJOR_LINE, swatch: "line" },
    { label: "Trails / paths", color: PATH_LINE, swatch: "dashed" },
    { label: "Railways", color: RAIL_LINE, swatch: "rail" },
] as const;
