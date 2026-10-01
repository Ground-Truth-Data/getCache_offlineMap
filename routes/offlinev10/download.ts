/**
 * Download one blob. Tiles already on disk are skipped: overlapping blobs share, never merge.
 * An empty tile (204) lands as a 0-byte row, so the store can tell a whole blob by looking.
 * A failed download takes back every tile it wrote, so nothing sits on disk without a blob.
 */

import { noteBytes } from "../../lib/shared/dataMeter.svelte";
import { sessionCap, spendBytes } from "../../lib/shared/sessionByteCap.svelte";
import { tileUrl } from "../../lib/worker/worker-local-dev/tilesHost";
import { BudgetError, budgetBytes } from "./budget";
import { nearestPlace } from "./places";
import {
	allTileKeys,
	bytesOfTiles,
	deleteTiles,
	patchRegion,
	putRegion,
	putTiles,
	type Region,
	regionId,
	usedBytes,
} from "./store";
import { rangeTiles, regionRange, type Tile, tileKey, toMerc } from "./tiles";

// One GET per tile: a batch's reads queue inside one Worker isolate, single GETs spread across many. 48 at once
// measured 1373 road tiles in 4.9 s against 16.6 s batched; 96 drew 500s.
const IN_FLIGHT = 40;
// Tiles per store write; each write repaints the map.
const FLUSH = 128;

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
	/** a repair keeps the row's birth time */
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
	// Coarse first, then outward from the pin, so the blob fills in from the middle.
	const [mx, my] = toMerc(lng, lat);
	const far = (t: Tile) => ((t.x + 0.5) / 2 ** t.z - mx) ** 2 + ((t.y + 0.5) / 2 ** t.z - my) ** 2;
	const todo = tiles.filter((t) => !have.has(tileKey(t))).sort((a, b) => a.z - b.z || far(a) - far(b));
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
		newBytes: p.bytes,
		ms: Math.round(performance.now() - t0),
		place: await nearestPlace(range, lng, lat),
	};
	if (opts.photo === false) region.photo = false;
	await (opts.keep ? patchRegion(region.id, region) : putRegion(region));
	return region;
}

async function fetchInto(
	todo: Tile[],
	p: Progress,
	written: string[],
	t0: number,
	onProgress?: (p: Progress) => void,
): Promise<void> {
	// The store is the wall; this early stop saves fetching a blob it cannot keep.
	const room = budgetBytes() - (await usedBytes());
	const urls = todo.map((t) => tileUrl(t.z, t.x, t.y));
	if (urls.some((u) => u === null))
		throw new Error(
			"no tiles host configured — configureTilesHost() must run before a blob downloads.",
		);
	let pending: Array<[string, ArrayBuffer]> = [];
	const writes: Promise<void>[] = [];
	const flush = (): void => {
		const batch = pending;
		pending = [];
		writes.push(
			putTiles(batch).then(() => {
				for (const [k] of batch) written.push(k);
				p.done += batch.length;
				p.ms = performance.now() - t0;
				onProgress?.(p);
			}),
		);
	};
	const fetched = getEach(
		urls as string[],
		(i, b) => {
			const k = tileKey(todo[i]);
			if (b === null) {
				pending.push([k, new ArrayBuffer(0)]);
				p.empty++;
			} else {
				pending.push([k, b]);
				p.fetched++;
				p.bytes += b.byteLength;
				noteBytes("map tiles", b.byteLength);
				spendBytes(b.byteLength);
			}
			if (pending.length >= FLUSH) flush();
		},
		() => {
			if (sessionCap.tripped) throw new Error("session byte cap reached");
			if (p.bytes > room) throw new BudgetError(budgetBytes() - room, budgetBytes(), p.bytes);
			return false;
		},
	);
	// Every write settles before a throw: the rollback reads `written`.
	const [got] = await Promise.allSettled([fetched]);
	if (got.status === "fulfilled") flush();
	const landed = await Promise.allSettled(writes);
	if (got.status === "rejected") throw got.reason;
	const bad = landed.find((l) => l.status === "rejected");
	if (bad) throw (bad as PromiseRejectedResult).reason;
}

/** One GET per tile, IN_FLIGHT at once, in `urls` order; a 204 is null, and so is a failure when `skipFailed`. `stop` runs before each fetch and may throw. */
export async function getEach(
	urls: readonly string[],
	onTile: (i: number, body: ArrayBuffer | null) => void,
	stop: () => boolean = () => false,
	skipFailed = false,
): Promise<void> {
	let next = 0;
	let failed: unknown = null;
	const lane = async (): Promise<void> => {
		while (next < urls.length && failed === null && !stop()) {
			const i = next++;
			onTile(i, await getOne(urls[i]).catch((e) => (skipFailed ? null : Promise.reject(e))));
		}
	};
	const lanes = await Promise.allSettled(
		Array.from({ length: IN_FLIGHT }, () =>
			lane().catch((e) => {
				failed ??= e;
				throw e;
			}),
		),
	);
	if (lanes.some((l) => l.status === "rejected")) throw failed;
}

async function getOne(url: string): Promise<ArrayBuffer | null> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url);
		if (res.status === 204) return null;
		if (res.ok) return res.arrayBuffer();
		// A cold isolate's first archive read can race; the retry lands warm.
		if (attempt === 1) throw new Error(`tile ${url}: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
	}
}
