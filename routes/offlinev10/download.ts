/**
 * Download one blob. Tiles already on disk are skipped: overlapping blobs share, never merge.
 * An empty tile (204) lands as a 0-byte row, so the store can tell a whole blob by looking.
 * Its row is written before its first tile, so a download that stops for any reason leaves nothing
 * unnamed; a failed one removes the row and every tile only it covered.
 */

import { noteBytes } from "../../lib/shared/dataMeter.svelte";
import { sessionCap, spendBytes } from "../../lib/shared/sessionByteCap.svelte";
import { tileUrl } from "../../lib/worker/worker-local-dev/tilesHost";
import { BLOB_COUNT_CAP, BudgetError, budgetBytes, fullMessage } from "./budget";
import { nearestPlace } from "./places";
import {
	AreaGone,
	allTileKeys,
	bytesOfTiles,
	deleteRegion,
	isRemoving,
	listRegions,
	patchRegion,
	putRegion,
	putTiles,
	type Region,
	regionId,
	usedBytes,
} from "./store";
import { rangeTiles, regionRange, type Tile, tileKey, toMerc } from "./tiles";

// One GET per tile spreads the reads over many Worker isolates; 96 at once drew 500s.
const IN_FLIGHT = 48;
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
	pin?: boolean;
	/** a repair keeps the row's birth time */
	keep?: Region;
}

/** Refuses before a byte is fetched when the area would not fit: its missing tiles at the
 * average size of the tiles already fetched. The store's wall still catches a bad guess, and
 * the download then takes back what it wrote. A repair adds no area, so only bytes count. */
export async function roomFor(lng: number, lat: number, repair = false): Promise<void> {
	const regions = await listRegions();
	if (!repair && regions.length >= BLOB_COUNT_CAP)
		throw new BudgetError(0, 0, 0, fullMessage(`${BLOB_COUNT_CAP} areas`));
	let tiles = 0;
	let bytes = 0;
	for (const r of regions)
		if (r.newBytes !== undefined) {
			tiles += r.fetched;
			bytes += r.newBytes;
		}
	const have = await allTileKeys();
	const missing = rangeTiles(regionRange(lng, lat)).filter((t) => !have.has(tileKey(t))).length;
	const used = await usedBytes();
	const guess = tiles > 0 ? Math.round((missing * bytes) / tiles) : 0;
	if (used + guess > budgetBytes()) throw new BudgetError(used, budgetBytes(), guess);
}

export async function downloadRegion(
	lng: number,
	lat: number,
	onProgress?: (p: Progress) => void,
	opts: DownloadOpts = {},
): Promise<Region> {
	const t0 = performance.now();
	const id = regionId(lng, lat);
	const range = regionRange(lng, lat);
	const tiles = rangeTiles(range);
	const at = opts.keep?.at ?? Date.now();
	const born: Region = { id, lng, lat, range, at, tiles: tiles.length, fetched: 0, bytes: 0, ms: 0, filling: true };
	if (opts.photo === false) born.photo = false;
	if (opts.pin) born.pin = true;
	if (!opts.keep) await putRegion(born);
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

	try {
		await fetchInto(id, todo, p, t0, onProgress);
	} catch (e) {
		// A row already gone was removed by whoever took it, and a removed one must stay.
		if (!opts.keep && !(e instanceof AreaGone)) await deleteRegion(id);
		throw e;
	}

	const region: Region = {
		...born,
		filling: undefined,
		fetched: p.fetched,
		bytes: await bytesOfTiles(tiles.map(tileKey)),
		newBytes: p.bytes,
		ms: Math.round(performance.now() - t0),
		place: await nearestPlace(range, lng, lat),
	};
	// A patch, so a row removed mid-download does not come back.
	await patchRegion(id, region);
	return region;
}

async function fetchInto(
	id: string,
	todo: Tile[],
	p: Progress,
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
	// A refused write (the row went, or the wall) stops the fetching, not just the writing.
	let refused: unknown = null;
	const flush = (): void => {
		const batch = pending;
		pending = [];
		writes.push(
			putTiles(batch, id).then(
				() => {
					p.done += batch.length;
					p.ms = performance.now() - t0;
					onProgress?.(p);
				},
				(e) => {
					refused ??= e;
				},
			),
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
			if (refused) throw refused;
			if (isRemoving(id)) throw new AreaGone(id);
			if (sessionCap.tripped) throw new Error("session byte cap reached");
			if (p.bytes > room) throw new BudgetError(budgetBytes() - room, budgetBytes(), p.bytes);
			return false;
		},
	);
	// Every write settles before a throw, so the rollback sees every tile.
	const [got] = await Promise.allSettled([fetched]);
	if (got.status === "fulfilled") flush();
	await Promise.all(writes);
	if (got.status === "rejected") throw got.reason;
	if (refused) throw refused;
}

/** One GET per tile, at most IN_FLIGHT across all callers, in `urls` order; a 204 is null, and so is a failure when `skipFailed`. `stop` runs before each fetch and may throw. */
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

// One pool for every caller: the map and its photo download together, and 96 at once drew 500s.
let free = IN_FLIGHT;
const queued: Array<() => void> = [];
function release(): void {
	const next = queued.shift();
	if (next) next();
	else free++;
}

async function getOne(url: string): Promise<ArrayBuffer | null> {
	if (free > 0) free--;
	else await new Promise<void>((r) => queued.push(r));
	try {
		return await getOnce(url);
	} finally {
		release();
	}
}

async function getOnce(url: string): Promise<ArrayBuffer | null> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url);
		if (res.status === 204) return null;
		if (res.ok) return res.arrayBuffer();
		// A cold isolate's first archive read can race; the retry lands warm.
		if (attempt === 1) throw new Error(`tile ${url}: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
	}
}
