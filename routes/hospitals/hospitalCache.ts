/**
 * hospitalCache — the hospitals both maps paint from, and WHICH of them belong
 * on screen. Same law as fires: measured from the user's ANCHORS (live fix +
 * ground touched in 30 days), never the camera; past HOSPITAL_RADIUS_KM from
 * every anchor nothing renders. What we download is what we may draw, so the
 * radius is one number: the disc the Worker is asked for and the wall.
 *
 * One IndexedDB (`rt-hospital-cache`), one disc per anchor, the Worker's
 * FeatureCollection stored verbatim and parsed only on paint. Hospitals change
 * glacially, so a disc is fresh for a month.
 */

import { distKm } from "../fires/fireRelevance";

export const HOSPITAL_RADIUS_KM = 500;
export const HOSPITAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DB_NAME = "rt-hospital-cache";
const DB_VERSION = 1;
const DISCS = "discs";

export interface HospitalDisc {
	key: string;
	lng: number;
	lat: number;
	radiusKm: number;
	fetchedAt: number;
	/** the Worker's FeatureCollection, verbatim */
	geojson: string;
}

export type LngLat = readonly [number, number];

export function hospitalKey(lng: number, lat: number): string {
	return `${lng.toFixed(4)},${lat.toFixed(4)}`;
}

// ── the two seams: discs landing, and a map asking for ground ──

const landed = new Set<() => void>();
/** A disc landed or left — the hospital layer repaints on this. */
export function onHospitals(fn: () => void): () => void {
	landed.add(fn);
	return () => {
		landed.delete(fn);
	};
}
export function notifyHospitals(): void {
	for (const fn of landed) fn();
}

const wanted = new Set<(centres: readonly LngLat[]) => void>();
/** The pass subscribes here; a map calls `wantHospitals` with its anchors and the pass fetches what is missing. Keeps the pages free of any Worker URL. */
export function onHospitalsWanted(
	fn: (centres: readonly LngLat[]) => void,
): () => void {
	wanted.add(fn);
	return () => {
		wanted.delete(fn);
	};
}
export function wantHospitals(centres: readonly LngLat[]): void {
	for (const fn of wanted) fn(centres);
}

// ── IndexedDB ──

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	if (dbp) return dbp;
	dbp = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(DISCS))
				db.createObjectStore(DISCS, { keyPath: "key" });
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => {
				db.close();
				dbp = null;
			};
			resolve(db);
		};
		req.onerror = () => {
			dbp = null;
			reject(req.error);
		};
	});
	return dbp;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

export async function readDisc(key: string): Promise<HospitalDisc | undefined> {
	const db = await open();
	return request(
		db.transaction(DISCS, "readonly").objectStore(DISCS).get(key),
	) as Promise<HospitalDisc | undefined>;
}

export async function allDiscs(): Promise<HospitalDisc[]> {
	const db = await open();
	return request(
		db.transaction(DISCS, "readonly").objectStore(DISCS).getAll(),
	) as Promise<HospitalDisc[]>;
}

export async function writeDisc(disc: HospitalDisc): Promise<void> {
	const db = await open();
	await request(
		db.transaction(DISCS, "readwrite").objectStore(DISCS).put(disc),
	);
	notifyHospitals();
}

export async function deleteDisc(key: string): Promise<void> {
	const db = await open();
	await request(
		db.transaction(DISCS, "readwrite").objectStore(DISCS).delete(key),
	);
	notifyHospitals();
}

export function isFresh(disc: HospitalDisc, now = Date.now()): boolean {
	return (
		now - disc.fetchedAt < HOSPITAL_TTL_MS &&
		disc.radiusKm >= HOSPITAL_RADIUS_KM
	);
}

/** Is `at` already inside a fresh disc? A disc only counts when the whole wall around `at` fits inside it. */
export function coveredBy(
	at: LngLat,
	discs: readonly HospitalDisc[],
	now = Date.now(),
): boolean {
	return discs.some(
		(d) =>
			isFresh(d, now) &&
			distKm(at, [d.lng, d.lat]) + HOSPITAL_RADIUS_KM <= d.radiusKm,
	);
}

/**
 * THE gate — every hospital the maps draw passes through here. Every cached
 * disc merged, a hospital counted once however many discs hold it, then only
 * those inside the wall of SOME anchor. No anchors → nothing.
 */
export async function hospitalCollection(
	origins: readonly LngLat[],
): Promise<GeoJSON.FeatureCollection> {
	const empty: GeoJSON.FeatureCollection = {
		type: "FeatureCollection",
		features: [],
	};
	if (origins.length === 0) return empty;
	const seen = new Set<string>();
	const features: GeoJSON.Feature[] = [];
	for (const disc of await allDiscs()) {
		let fc: GeoJSON.FeatureCollection;
		try {
			fc = JSON.parse(disc.geojson) as GeoJSON.FeatureCollection;
		} catch {
			continue;
		}
		for (const f of fc.features) {
			if (f.geometry?.type !== "Point") continue;
			const [x, y] = f.geometry.coordinates;
			const id = `${x},${y}`;
			if (seen.has(id)) continue;
			seen.add(id);
			const at: LngLat = [x, y];
			if (!origins.some((o) => distKm(o, at) < HOSPITAL_RADIUS_KM)) continue;
			features.push(f);
		}
	}
	return { type: "FeatureCollection", features };
}
