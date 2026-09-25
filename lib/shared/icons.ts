// One list for every icon in the app: add a row here, never a second file.

import pdfMapsIcon from "../assets/pdf_maps_icon.webp";
import backupIcon from "../assets/backup_icon.webp";
import tracksIcon from "$parent/siblings/getCache_OnlineMap/lib/assets/mobileAssets/tracks_goldV3.webp";
import cacheIconUrl from "$gc/assets/cache_icon.webp";

const DIR = "/mobileAssets";

// Imported, never a leading-slash URL, so the bundler emits it under whichever tier serves the page.
const PIN_LIBRARY = "../assets/pin_library_small";
const PIN_URLS = import.meta.glob("../assets/pin_library_small/*.webp", {
    eager: true,
    query: "?url",
    import: "default",
}) as Record<string, string>;

/** Throws at module init on a name not on disk — a typo must not become a 404 in front of a user. */
export function pinLibraryUrl(file: string): string {
    const url = PIN_URLS[`${PIN_LIBRARY}/${file}`];
    if (!url)
        throw new Error(`icons.ts: no ${file} in lib/assets/pin_library_small`);
    return url;
}

// Persisted by this string, so the set is a stable contract.
export type PinKey =
    | "pin"
    | "cache"
    | "truck"
    | "bear"
    | "heli"
    | "crossing"
    | "noCrossing"
    | "warning"
    | "atv"
    | "muster"
    | "home"
    | "poop"
    | "tree"
    | "red"
    | "orange"
    | "yellow"
    | "green"
    | "blue"
    | "purple";

export type IconName =
    | PinKey
    | "map"
    | "block"
    | "project"
    | "box"
    | "cacheGroup"
    | "tally"
    | "poly"
    | "line"
    | "track"
    | "pdf"
    | "tiles"
    | "quality"
    | "qualityWhite"
    | "backup"
    | "cleanCache"
    | "handPointLeft"
    | "handPointRight";

export type IconRow = {
    name: IconName;
    path: string;
    /** Present only on a user-droppable map pin: its library section. */
    pin?: "glyph" | "rainbow";
};

export type PinRow = IconRow & { name: PinKey; pin: "glyph" | "rainbow" };

export const ICONS: readonly IconRow[] = [
    // Row order = display order; "pin" sits last as the default.
    { name: "truck", pin: "glyph", path: pinLibraryUrl("pin_truck_sm.webp") },
    { name: "cache", pin: "glyph", path: pinLibraryUrl("pin_cache_sm.webp") },
    { name: "atv", pin: "glyph", path: pinLibraryUrl("pin_atv_sm.webp") },
    { name: "bear", pin: "glyph", path: pinLibraryUrl("pin_bear_sm.webp") },
    {
        name: "heli",
        pin: "glyph",
        path: pinLibraryUrl("pin_helicopter_sm.webp"),
    },
    {
        name: "crossing",
        pin: "glyph",
        path: pinLibraryUrl("pin_crossing_good_sm.webp"),
    },
    {
        name: "noCrossing",
        pin: "glyph",
        path: pinLibraryUrl("pin_crossing_bad_sm.webp"),
    },
    { name: "warning", pin: "glyph", path: pinLibraryUrl("pin_warn_sm.webp") },
    {
        name: "muster",
        pin: "glyph",
        path: pinLibraryUrl("pin_muster_point_sm.webp"),
    },
    { name: "home", pin: "glyph", path: pinLibraryUrl("pin_home_sm.webp") },
    // Baked by tools/makeEmojiPins.mjs.
    {
        name: "poop",
        pin: "glyph",
        path: pinLibraryUrl("pin_emoji_poop_sm.webp"),
    },
    { name: "tree", pin: "glyph", path: pinLibraryUrl("pin_tree_sm.webp") },
    { name: "pin", pin: "glyph", path: pinLibraryUrl("pin_default_sm.webp") },
    { name: "red", pin: "rainbow", path: pinLibraryUrl("1pin_red_sm.webp") },
    {
        name: "orange",
        pin: "rainbow",
        path: pinLibraryUrl("2pin_orange_sm.webp"),
    },
    {
        name: "yellow",
        pin: "rainbow",
        path: pinLibraryUrl("3pin_yellow_sm.webp"),
    },
    {
        name: "green",
        pin: "rainbow",
        path: pinLibraryUrl("4pin_green_sm.webp"),
    },
    { name: "blue", pin: "rainbow", path: pinLibraryUrl("5pin_blue_sm.webp") },
    {
        name: "purple",
        pin: "rainbow",
        path: pinLibraryUrl("6pin_purple_sm.webp"),
    },
    { name: "map", path: `${DIR}/map_icon_v2_sm.webp` },
    // Deliberately unlike the map/poly/line outlines: a block is administrative, not drawn.
    { name: "block", path: `${DIR}/block_icon_sm.webp` },
    { name: "project", path: `${DIR}/project_icon_sm.webp` },
    { name: "box", path: `${DIR}/box_icon_V9.webp` },
    { name: "cacheGroup", path: cacheIconUrl },
    { name: "tally", path: `${DIR}/cent_icon_plain_v3_gold.webp` },
    { name: "poly", path: `${DIR}/blockHeart_sm2.webp` },
    { name: "line", path: `${DIR}/line_icon.webp` },
    // A track is NOT a line; never give it line_icon.
    { name: "track", path: tracksIcon },
    { name: "pdf", path: pdfMapsIcon },
    { name: "backup", path: backupIcon },
    { name: "tiles", path: pinLibraryUrl("pin_tiles_sm.webp") },
    // Animated webps are built from a sibling frame folder by scripts/rebuild-anime-webp.sh <name> — edit the frames and rerun, never the .webp.
    { name: "quality", path: `${DIR}/animations/quality_icon.webp` },
    { name: "qualityWhite", path: `${DIR}/animations/quality_icon_white.webp` },
    { name: "cleanCache", path: `${DIR}/animations/cleanCache_anime.webp` },
    { name: "handPointLeft", path: `${DIR}/hand_point_left.webp` },
    { name: "handPointRight", path: `${DIR}/hand_point_right.png` },
];

const BY_NAME = new Map<string, IconRow>(ICONS.map((r) => [r.name, r]));

/** Falls back to the default pin on an unmapped name rather than throwing. */
export function iconPath(name: IconName): string {
    return (BY_NAME.get(name) ?? BY_NAME.get(DEFAULT_PIN_KEY))?.path ?? "";
}

export function pinAssetPath(key: PinKey): string {
    return (BY_NAME.get(key) ?? BY_NAME.get(DEFAULT_PIN_KEY))?.path ?? "";
}

const PIN_ROWS: readonly PinRow[] = ICONS.filter(
    (r): r is PinRow => r.pin !== undefined,
);

export const GLYPH_PINS: readonly PinRow[] = PIN_ROWS.filter(
    (r) => r.pin === "glyph",
);

export const RAINBOW_PINS: readonly PinRow[] = PIN_ROWS.filter(
    (r) => r.pin === "rainbow",
);

export const ALL_PINS: readonly PinRow[] = PIN_ROWS;

/** The pin a feature carries before the user deliberately picks one. */
export const DEFAULT_PIN_KEY: PinKey = "pin";

const PIN_SET: ReadonlySet<string> = new Set(ALL_PINS.map((r) => r.name));

/** Parse an untrusted string (KML ExtendedData, envelope field, deep-link param) into a PinKey, or null if it isn't one. */
export function parsePinKey(raw: unknown): PinKey | null {
    return typeof raw === "string" && PIN_SET.has(raw) ? (raw as PinKey) : null;
}

// pinTypeKey is an open namespace (emoji:<char>, plot:<n>): never string-match one inline — ask this module, or its readers drift apart.

export const EMOJI_PIN_PREFIX = "emoji:";

/** Not in ICONS — never selectable on its own, only as an emoji's backing plate. */
export const EMOJI_PIN_PLATE = pinLibraryUrl("pin_blank_emoji_sm.webp");

// Import-free module so the baking script can read it from bare Node.
export * from "./emojiPinGeometry";

/** The mirror of parsePinKey; together they're exhaustive over user-pickable pins. */
export function parseEmojiPin(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw.startsWith(EMOJI_PIN_PREFIX))
        return null;
    const char = raw.slice(EMOJI_PIN_PREFIX.length);
    // "emoji:" alone falls back to the default pin, not an invisible marker.
    return char.length > 0 ? char : null;
}

/** The only place this key is assembled; callers never concatenate the prefix. */
export function emojiPinKey(char: string): string {
    return `${EMOJI_PIN_PREFIX}${char}`;
}
