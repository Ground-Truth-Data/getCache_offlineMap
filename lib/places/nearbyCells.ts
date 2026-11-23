/** The named features and small places a shape is named after: 5° cells fetched once and kept on the phone. Naming reads only what is held. */

import { makeKeyedIdbStore } from "../onPhone/store/keyedIdbStore";
import { NEARBY_DB } from "../onPhone/store/dbCatalog";

/** [name, lng, lat, 1 = feature (bay, beach, peak, park, forest) | 0 = place]. */
export type NearbyRow = readonly [string, number, number, 0 | 1];

const CELL_DEG = 5;
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
			cells.add(`${Math.floor((x + 180) / CELL_DEG)}_${Math.floor((y + 90) / CELL_DEG)}`);
	return [...cells];
}

export async function heldNearby(cells: readonly string[]): Promise<NearbyRow[]> {
	return (await Promise.all(cells.map((c) => store.get(c)))).flatMap((rows) => rows ?? []);
}

/** Fetches the cells not yet held. A cell with no file (open ocean, or a host without the folder) is not kept, so it is asked for again. */
export async function fetchNearby(cells: readonly string[]): Promise<void> {
	const held = new Set(await store.keys());
	await Promise.all(
		cells
			.filter((c) => !held.has(c))
			.map(async (c) => {
				const res = await fetch(`${base()}/mobileAssets/nearby/${c}.json`);
				if (res.ok) await store.put(c, await res.json());
				else if (res.status !== 404) throw new Error(`nearby cell ${c}: HTTP ${res.status}`);
			}),
	);
}
