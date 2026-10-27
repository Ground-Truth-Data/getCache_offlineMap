/** The world's highways, one PMTiles file fetched once and kept on the phone: routing between blobs, and the roads the offline map draws where no blob covers. */

import { FileSource, PMTiles } from "pmtiles";
import { tilesHost } from "../worker/tilesHost";

const DB = "gc-highways";
const STORE = "file";
const KEY = "highways.pmtiles";

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

async function load(): Promise<PMTiles> {
	let blob = await idb<Blob | undefined>("readonly", (s) => s.get(KEY));
	if (!blob) {
		const host = tilesHost();
		if (!host) throw new Error("no tiles host");
		const r = await fetch(`${host}/${KEY}`);
		if (!r.ok) throw new Error(`${host}/${KEY} → ${r.status}`);
		blob = await r.blob();
		await idb("readwrite", (s) => s.put(blob, KEY));
	}
	return new PMTiles(new FileSource(new File([blob], KEY)));
}

let archive: Promise<PMTiles> | null = null;

/** The tile's bytes, or undefined when no highway crosses it. Throws while the file can't be had; the next call tries again. */
export async function highwayTile(z: number, x: number, y: number): Promise<ArrayBuffer | undefined> {
	archive ??= load().catch((e) => {
		archive = null;
		console.error("[highways] would not load: no drive leaves the downloaded areas, and no road is drawn outside them", e);
		throw e;
	});
	return (await (await archive).getZxy(z, x, y))?.data;
}
