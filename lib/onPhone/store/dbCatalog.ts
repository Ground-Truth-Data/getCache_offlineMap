/** Classifies this origin's IndexedDB DBs. A store not registered here is legacy and offered up for wipe. */

import {
	currentDbName,
	SANDBOX_SUFFIX,
} from "../../shared/sandboxDbNames";

/** TinyBase store: live user data. */
export const APP_DB = "rt-treeStuff";

export const V4_TILES_DB = "gc-offlineTiles";
export const LEGACY_VECTORS_DB_NAME = "rt-vectors";
/** Keep in sync with satelliteImage.ts's DB name, or live photos classify as legacy. */
export const SAT_DB = "gc-offlineSatellite";
export const REGISTRY_DB = "rt-mapRegistry";
export const FIRE_DB = "rt-fire-cache";

/** Strip a world suffix (`-sandbox`, `-sandbox-<name>`) to the base name. */
export function baseDbName(db: string): string {
	const i = db.indexOf(SANDBOX_SUFFIX);
	return i === -1 ? db : db.slice(0, i);
}

/** The OTHER world's name for a base store (`x` ⇄ `x-sandbox`). */
export function otherWorldDbName(base: string): string {
	return currentDbName(base) === base ? base + SANDBOX_SUFFIX : base;
}

/** Callers skip these in per-blob scans: tens of thousands of tiny blobs hang the page. */
export function isV4Tiles(db: string): boolean {
	const b = baseDbName(db);
	return b === V4_TILES_DB || b.startsWith("retreever-v4-tiles");
}

/** Base names of the live offline stores, either world. */
export function isLiveBase(b: string): boolean {
	return (
		b === V4_TILES_DB ||
		b === SAT_DB ||
		b === REGISTRY_DB ||
		b === FIRE_DB ||
		b === LEGACY_VECTORS_DB_NAME
	);
}

/** Live offline DBs of the current world. */
export function isLiveV4(db: string): boolean {
	const b = baseDbName(db);
	return isLiveBase(b) && db === currentDbName(b);
}

/** The other world's data: never legacy, never wipeable. */
export function isOtherWorld(db: string): boolean {
	const b = baseDbName(db);
	return (isLiveBase(b) || b === APP_DB) && db !== currentDbName(b);
}

export function isLegacyDb(db: string): boolean {
	return !isLiveV4(db) && !isOtherWorld(db) && baseDbName(db) !== APP_DB;
}

/** Imagery a re-download restores, so sign-out keeps it. A store holding user data here leaks it to the next person at the browser. */
const IMPERSONAL_BASES = [V4_TILES_DB, SAT_DB];

/** True when a database must not outlive the signed-in session, either world. */
export function isPersonalDb(db: string): boolean {
	return !IMPERSONAL_BASES.includes(baseDbName(db));
}
