/** The named features and small places a shape is named after: 2.5° cells, named by their south-west corner, fetched once and kept on the phone. Naming reads only what is held. */

import { makeKeyedIdbStore } from "../onPhone/store/keyedIdbStore";
import { NEARBY_DB } from "../onPhone/store/dbCatalog";

/** [name, lng, lat, 1 = feature (bay, beach, peak, park, forest) | 0 = place]. */
export type NearbyRow = readonly [string, number, number, 0 | 1];

const CELL_DEG = 2.5;
const store = makeKeyedIdbStore<NearbyRow[]>({ dbName: NEARBY_DB, storeName: "cells" });
// Capacitor serves the app from localhost with no port, where the cells don't ship; they come from the web host.
const base = () => (location.hostname === "localhost" && !location.port ? "https://getcache.org" : "");

/** The cells under a square `km` either side of a point. */
export function cellsAround(lng: number, lat: number, km: number): string[] {
	const dLat = km / 111;
	const dLng = dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
	const cells = new Set<string>();
	for (const x of [lng - dLng, lng + dLng])
		for (const y of [lat - dLat, lat + dLat])
			cells.add(`${Math.floor(x / CELL_DEG) * CELL_DEG}_${Math.floor(y / CELL_DEG) * CELL_DEG}`);
	return [...cells];
}

export async function heldNearby(cells: readonly string[]): Promise<NearbyRow[]> {
	return (await Promise.all(cells.map((c) => store.get(c)))).flatMap((rows) => rows ?? []);
}

/** Fetches the cells not yet held; every cell has a file, empty in open ocean, so any failure keeps nothing. */
export async function fetchNearby(cells: readonly string[]): Promise<void> {
	const held = new Set(await store.keys());
	await Promise.all(
		cells
			.filter((c) => !held.has(c))
			.map(async (c) => {
				const res = await fetch(`${base()}/mobileAssets/nearby/${c}.json`);
				if (!res.ok) throw new Error(`nearby cell ${c}: HTTP ${res.status}`);
				await store.put(c, await res.json());
			}),
	);
}
