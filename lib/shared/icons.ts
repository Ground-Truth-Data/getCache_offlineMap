// icons.ts — the icon file for the whole mobile app. ONE list, ICONS: name + path (pin rows also carry their section). Add an icon = add a row, never a second file.

import pdfMapsIcon from "../assets/pdf_maps_icon.webp";
import tracksIcon from "$parent/siblings/getCache_OnlineMap/lib/assets/mobileAssets/tracks_goldV3.webp";
import cacheIconUrl from "$gc/assets/cache_icon.webp";

const DIR = "/mobileAssets";

// The pin artwork travels WITH this child: imported, never a leading-slash URL, so the bundler emits it under whichever tier (or solo scaffold) serves the page.
const PIN_LIBRARY = "../assets/pin_library_small";
const PIN_URLS = import.meta.glob("../assets/pin_library_small/*.webp", {
    eager: true,
    query: "?url",
    import: "default",
}) as Record<string, string>;

/** The served URL of one file in the pin library. Throws at module init on a name that is not on disk — a typo here must not become a 404 in front of a user. */
export function pinLibraryUrl(file: string): string {
    const url = PIN_URLS[`${PIN_LIBRARY}/${file}`];
    if (!url)
        throw new Error(`icons.ts: no ${file} in lib/assets/pin_library_small`);
    return url;
}

// A map pin's name — saved into features/shared files by this string, so the set is a stable contract.
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

// Every icon name — pins plus the non-pin glyphs (inbox / shapes).
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
    | "cleanCache"
    | "handPointLeft"
    | "handPointRight";

export type IconRow = {
    /** The name of the thing. This is what gets saved / referenced. */
    name: IconName;
    /** Path to its picture. Right here, on the same row. */
    path: string;
    /** Set ONLY if this icon is a user-droppable map pin, naming its library section. Absent = not a pin. */
    pin?: "glyph" | "rainbow";
};

/** A pin row — `name` is a PinKey, `pin` is guaranteed present. */
export type PinRow = IconRow & { name: PinKey; pin: "glyph" | "rainbow" };

export const ICONS: readonly IconRow[] = [
    // Row order = display order (feeds the quick-pick row too); "pin" sits LAST as the default every feature starts with.
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
    // Baked by tools/makeEmojiPins.mjs — the one emoji that earned a fixed tile.
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
    // Deliberately unlike the organic map/poly/line outlines: a block is an
    // administrative unit, not a drawn shape, so it must never read as one.
    { name: "block", path: `${DIR}/block_icon_sm.webp` },
    { name: "project", path: `${DIR}/project_icon_sm.webp` },
    { name: "box", path: `${DIR}/box_icon_V9.webp` },
    { name: "cacheGroup", path: cacheIconUrl },
    { name: "tally", path: `${DIR}/cent_icon_plain_v3_gold.webp` },
    { name: "poly", path: `${DIR}/blockHeart_sm2.webp` },
    { name: "line", path: `${DIR}/line_icon.webp` },
    // GPS breadcrumb tracks — same art as the TRACKS drawer tile. A track is NOT a line; never gets line_icon.
    { name: "track", path: tracksIcon },
    { name: "pdf", path: pdfMapsIcon },
    { name: "tiles", path: pinLibraryUrl("pin_tiles_sm.webp") },
    // Animated webps are single self-animating files, NOT frame folders — built from a sibling frame folder by scripts/rebuild-anime-webp.sh <name>. Edit the frames, rerun the script, or the app keeps showing the old file forever.
    // The gold quality glyph — inbox rows, plot popovers, the Quality tab.
    { name: "quality", path: `${DIR}/animations/quality_icon.webp` },
    // White variant — for gold/dark backgrounds (tab bar active, snake ruler).
    { name: "qualityWhite", path: `${DIR}/animations/quality_icon_white.webp` },
    // The sweeping-broom timelapse shown while slow work runs (imports, conversions, admin loads).
    { name: "cleanCache", path: `${DIR}/animations/cleanCache_anime.webp` },
    // The shovel-gripping hand, tweened along a path by Fingers.svelte; fingertip anchors live in animation/components_anime/demos/demoConfigs.ts — only the URLs are here.
    { name: "handPointLeft", path: `${DIR}/hand_point_left.webp` },
    { name: "handPointRight", path: `${DIR}/hand_point_right.png` },
];

const BY_NAME = new Map<string, IconRow>(ICONS.map((r) => [r.name, r]));

/** The one and only way to get an icon path. Falls back to the default pin rather than crashing — the old BY_NAME.get(name)!.path threw on an unmapped name and white-screened whatever rendered it. */
export function iconPath(name: IconName): string {
    return (BY_NAME.get(name) ?? BY_NAME.get(DEFAULT_PIN_KEY))?.path ?? "";
}

/** The path for a pin (same table, narrower type) — same default-on-miss hardening as iconPath. */
export function pinAssetPath(key: PinKey): string {
    return (BY_NAME.get(key) ?? BY_NAME.get(DEFAULT_PIN_KEY))?.path ?? "";
}

const PIN_ROWS: readonly PinRow[] = ICONS.filter(
    (r): r is PinRow => r.pin !== undefined,
);

/** Artwork pins — the library's top (untitled) section. */
export const GLYPH_PINS: readonly PinRow[] = PIN_ROWS.filter(
    (r) => r.pin === "glyph",
);

/** Rainbow colour pins — the library's "RAINBOW" section. */
export const RAINBOW_PINS: readonly PinRow[] = PIN_ROWS.filter(
    (r) => r.pin === "rainbow",
);

/** Every pin row, glyphs then rainbow. */
export const ALL_PINS: readonly PinRow[] = PIN_ROWS;

/** The pin a feature carries before the user deliberately picks one. */
export const DEFAULT_PIN_KEY: PinKey = "pin";

const PIN_SET: ReadonlySet<string> = new Set(ALL_PINS.map((r) => r.name));

/** Parse an untrusted string (KML ExtendedData, envelope field, deep-link param) into a PinKey, or null if it isn't one. */
export function parsePinKey(raw: unknown): PinKey | null {
    return typeof raw === "string" && PIN_SET.has(raw) ? (raw as PinKey) : null;
}

// pinTypeKey is a namespace (emoji:<char>, plot:<n>), not a closed enum. ⚠️ Never string-match a pin key inline — always ask this module, or the map/inbox/detail-sheet/KMZ exporter drift apart.

/** The prefix marking a pin whose artwork is a system-font emoji. */
export const EMOJI_PIN_PREFIX = "emoji:";

/** The blank gold pin an emoji is composited onto. Not in ICONS — never selectable on its own, only as an emoji's backing plate. */
export const EMOJI_PIN_PLATE = pinLibraryUrl("pin_blank_emoji_sm.webp");

/** The emoji character in an emoji:<char> key, or null otherwise — the mirror of parsePinKey; together they're exhaustive over user-pickable pins. */
export function parseEmojiPin(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw.startsWith(EMOJI_PIN_PREFIX))
        return null;
    const char = raw.slice(EMOJI_PIN_PREFIX.length);
    // Guard the empty tail ("emoji:") — must fall back to the default pin rather than render an invisible marker.
    return char.length > 0 ? char : null;
}

/** Build the pinTypeKey for an emoji — the only place this string is assembled; callers never concatenate the prefix themselves. */
export function emojiPinKey(char: string): string {
    return `${EMOJI_PIN_PREFIX}${char}`;
}
