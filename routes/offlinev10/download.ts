/**
 * Download one blob: the whole pyramid MIN_Z..MAX_Z under the pin's anchor tiles,
 * fetched from the Worker with a wide pool, written to the store in batches.
 * Tiles already on disk are skipped — two blobs that overlap share, they
 * never merge.
 *
 * Every tile of the blob ends up as a row, an empty one (204 from the Worker)
 * as a 0-byte row: the store can then say whether a blob is whole by looking,
 * never by guessing what the Worker had. A download that fails for any reason
 * — the budget, the network, the Worker — takes back every tile it wrote, so
 * nothing sits on disk without a blob to own it.
 */

import { tileUrl } from "../../lib/worker/worker-local-dev/tilesHost";
import { BudgetError, budgetBytes } from "./budget";
import { nearestPlace } from "./places";
import {
	allTileKeys,
	bytesOfTiles,
	deleteTiles,
	putRegion,
	putTiles,
	type Region,
	regionId,
	usedBytes,
} from "./store";
import { rangeTiles, regionRange, type Tile, tileKey } from "./tiles";

const POOL = 32;
const BATCH = 64;

export interface Progress {
	total: number;
	done: number;
	fetched: number;
	bytes: number;
	empty: number;
	ms: number;
}

export interface DownloadOpts {
	photo?: boolean;
	/** a repair keeps the row's birth time, so the blob does not jump to FOCUSED */
	keep?: Region;
}

export async function downloadRegion(
	lng: number,
	lat: number,
	onProgress?: (p: Progress) => void,
	opts: DownloadOpts = {},
): Promise<Region> {
	const t0 = performance.now();
	const range = regionRange(lng, lat);
	const tiles = rangeTiles(range);
	const have = await allTileKeys();
	const todo = tiles.filter((t) => !have.has(tileKey(t)));
	const p: Progress = {
		total: tiles.length,
		done: tiles.length - todo.length,
		fetched: 0,
		bytes: 0,
		empty: 0,
		ms: 0,
	};
	onProgress?.(p);

	const written: string[] = [];
	try {
		await fetchInto(todo, p, written, t0, onProgress);
	} catch (e) {
		await deleteTiles(written);
		throw e;
	}

	const region: Region = {
		id: regionId(lng, lat),
		lng,
		lat,
		range,
		at: opts.keep?.at ?? Date.now(),
		tiles: tiles.length,
		fetched: p.fetched,
		bytes: await bytesOfTiles(tiles.map(tileKey)),
		ms: Math.round(performance.now() - t0),
		place: await nearestPlace(range, lng, lat),
	};
	if (opts.photo === false) region.photo = false;
	await putRegion(region);
	return region;
}

/** The pool: fetch every tile in `todo`, write in batches, record each key the moment it is on disk. */
async function fetchInto(
	todo: Tile[],
	p: Progress,
	written: string[],
	t0: number,
	onProgress?: (p: Progress) => void,
): Promise<void> {
	// The store is the wall; this is the early stop, so the pool does not fetch a whole blob it cannot keep.
	const room = budgetBytes() - (await usedBytes());
	let pending: Array<[string, ArrayBuffer]> = [];
	let flushing: Promise<void> = Promise.resolve();
	let failed: unknown = null;
	const flush = () => {
		if (pending.length === 0) return;
		const batch = pending;
		pending = [];
		flushing = flushing.then(async () => {
			await putTiles(batch);
			for (const [k] of batch) written.push(k);
		});
		flushing.catch((e) => {
			failed = e;
		});
	};

	let next = 0;
	const worker = async () => {
		while (next < todo.length) {
			if (failed) throw failed;
			if (p.bytes > room)
				throw new BudgetError(budgetBytes() - room, budgetBytes(), p.bytes);
			const t = todo[next++];
			const url = tileUrl(t.z, t.x, t.y);
			if (url === null)
				throw new Error(
					"no tiles host configured — configureTilesHost() must run before a blob downloads.",
				);
			const res = await fetch(url);
			if (res.status === 200) {
				const buf = await res.arrayBuffer();
				pending.push([tileKey(t), buf]);
				p.fetched++;
				p.bytes += buf.byteLength;
			} else if (res.status === 204) {
				pending.push([tileKey(t), new ArrayBuffer(0)]);
				p.empty++;
			} else {
				throw new Error(`tile ${tileKey(t)}: HTTP ${res.status}`);
			}
			if (pending.length >= BATCH) flush();
			p.done++;
			p.ms = performance.now() - t0;
			onProgress?.(p);
		}
	};
	try {
		await Promise.all(
			Array.from({ length: Math.min(POOL, todo.length) }, worker),
		);
	} catch (e) {
		// a batch may still be landing; `written` is only complete once it has, and the rollback reads it
		await flushing.catch(() => undefined);
		throw e;
	}
	flush();
	await flushing;
}
