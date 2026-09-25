/** The Worker filters BY this table and the phone's report reads FROM it, so the two cannot disagree. */

export interface PackLayerRule {
    /** Attribute the allowlist matches. Omitted = `kind`. */
    readonly key?: string;
    /** Omitted = the WHOLE layer ships. */
    readonly kinds?: readonly string[];
    readonly why: string;
}

export const PACK_LAYERS: Readonly<Record<string, PackLayerRule>> = {
    roads: {
        why: "every road, path and rail line — nothing dropped by kind (one blob, drawn at every zoom)",
    },
    water: {
        kinds: ["water", "lake", "river", "canal"],
        why: "lake / pond polygons and river + canal lines; streams dropped (50 kB of sub-pixel creeks)",
    },
    places: {
        key: "kind_detail",
        kinds: ["city", "town", "village", "hamlet"],
        why: "town labels — Protomaps v4 files city/town/village/hamlet under kind_detail, kind is always `locality`",
    },
    pois: {
        kinds: ["hospital", "camp_site"],
        why: "the two icons the map draws — a handful of points per disc",
    },
};

export const PACK_LAYER_NAMES: readonly string[] = Object.keys(PACK_LAYERS);

/** Shallow (z6) keep-set: small roads live only inside a pin's disc — a z6 tile
 *  spans ~600 km and minor_road in it is a province of driveways. */
export const SHALLOW_LAYER_RULES: Readonly<Record<string, PackLayerRule>> = {
    ...PACK_LAYERS,
    roads: {
        // The archive's vocabulary is `major_road`; a short "major" matches nothing.
        kinds: ["highway", "major_road"],
        why: "highways + major roads only, in the ARCHIVE vocabulary (*_road) — small roads ship only inside the z8 disc",
    },
};

export interface PackRead {
    readonly layer: string;
    /** Omitted = `kind`. */
    readonly key?: string;
    /** Omitted = it reads the whole layer. */
    readonly kinds?: readonly string[];
}

/** TRUE only when every kind the style filters on survives the allowlist under the SAME attribute key. */
export function packShips(read: PackRead): boolean {
    const rule = PACK_LAYERS[read.layer];
    if (!rule) return false;
    if (!rule.kinds) return true;
    if (!read.kinds) return false;
    if ((read.key ?? "kind") !== (rule.key ?? "kind")) return false;
    return read.kinds.every((k) => rule.kinds!.includes(k));
}

export function describePackLayer(layer: string): string {
    const rule = PACK_LAYERS[layer];
    if (!rule) return `${layer} (NOT shipped)`;
    if (!rule.kinds) return `${layer} (all)`;
    return `${layer} ${rule.key ?? "kind"}∈{${rule.kinds.join(",")}}`;
}
