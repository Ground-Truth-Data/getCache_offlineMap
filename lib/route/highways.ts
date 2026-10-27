/** The world's highways, one PMTiles file fetched once on Wi-Fi and kept on the phone: routing between blobs, and the roads the offline map draws where no blob covers. */

import { FileSource, PMTiles } from "pmtiles";
import { onWifi, tilesHost } from "../worker/tilesHost";

/** A rebuilt file gets the next number: a phone holding another name fetches this one and drops its old copy. */
const NAME = "highways-v1.pmtiles";
const DB = "gc-highways";
const STORE = "file";
const KEY = "highways";

type Kept = { name: string; blob: Blob };

function idb<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return new Promise((ok, fail) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onerror = () => fail(req.error);
		req.onsuccess = () => {
			const db = req.result;
			const r = act(db.transaction(STORE, mode).objectStore(STORE));
			r.onsuccess = () => (db.close(), ok(r.result));
			r.onerror = () => (db.close(), fail(r.error));
		};
	});
}

async function load(): Promise<PMTiles | null> {
	const kept = await idb<Kept | undefined>("readonly", (s) => s.get(KEY));
	let blob = kept?.name === NAME ? kept.blob : null;
	if (!blob) {
		if (!(await onWifi())) return null;
		const host = tilesHost();
		if (!host) throw new Error("no tiles host");
		const r = await fetch(`${host}/${NAME}`);
		if (!r.ok) throw new Error(`${host}/${NAME} → ${r.status}`);
		const fresh: Kept = { name: NAME, blob: await r.blob() };
		await idb("readwrite", (s) => s.put(fresh, KEY));
		blob = fresh.blob;
	}
	return new PMTiles(new FileSource(new File([blob], NAME)));
}

/** Off Wi-Fi or failed, the next try waits this long: a map frame asks for dozens of tiles at once. */
const RETRY_MS = 60_000;
let archive: Promise<PMTiles | null> | null = null;

/** The tile's bytes; undefined when no highway crosses it, or the file isn't on the phone yet. */
export async function highwayTile(z: number, x: number, y: number): Promise<ArrayBuffer | undefined> {
	archive ??= load()
		.catch((e) => {
			console.error("[highways] would not load: no drive leaves the downloaded areas, and no road is drawn outside them", e);
			return null;
		})
		.then((got) => {
			if (!got) setTimeout(() => (archive = null), RETRY_MS);
			return got;
		});
	return (await (await archive)?.getZxy(z, x, y))?.data;
}
