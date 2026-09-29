/// <reference lib="webworker" />
// satBakeWorker.ts — the satellite compositor, off the UI thread; falls back to the main thread in satelliteImage.ts where OffscreenCanvas/convertToBlob aren't available.

type TileDraw = { key: string; url: string; dx: number; dy: number; dw: number; dh: number };
type BakeReq = {
	id: number;
	tiles: TileDraw[];
	w: number;
	h: number;
	quality: number;
};
type RawTile = [string, ArrayBuffer];
type BakeRes = { id: number; blob: Blob | null; loaded: number; fetched: number; bytes: number; tiles: RawTile[] };

// Each tile is drawn once and dropped: a bake never asks for a URL twice, so a decoded-tile cache only held memory.
async function loadTile(url: string, onBytes: (buf: ArrayBuffer) => void): Promise<ImageBitmap | null> {
	try {
		// The bake has no wall clock, so a stalled tile ends here, alone — a wall clock made the caller refetch every tile.
		const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
		if (!r.ok) return null;
		const buf = await r.arrayBuffer();
		onBytes(buf);
		return await createImageBitmap(new Blob([buf]));
	} catch {
		return null;
	}
}

self.onmessage = async (e: MessageEvent<BakeReq>): Promise<void> => {
	const { id, tiles, w, h, quality } = e.data;
	let loaded = 0;
	let fetched = 0;
	let bytes = 0;
	const raw: RawTile[] = [];
	const post = (blob: Blob | null): void => {
		const res: BakeRes = { id, blob, loaded, fetched, bytes, tiles: blob ? raw : [] };
		(self as unknown as Worker).postMessage(res, res.tiles.map(([, b]) => b));
	};
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		post(null);
		return;
	}
	// Bounded concurrency, mirroring the main-thread pool.
	const LIMIT = 16;
	let next = 0;
	const work = async (): Promise<void> => {
		while (next < tiles.length) {
			const t = tiles[next++];
			fetched += 1;
			const bm = await loadTile(t.url, (buf) => {
				bytes += buf.byteLength;
				raw.push([t.key, buf]);
				// Per tile, not at the end: the page's byte cap can only stop what it hears about.
				(self as unknown as Worker).postMessage({ spent: buf.byteLength });
			});
			if (!bm) continue; // gap → transparent → jagged mask
			ctx.drawImage(bm, t.dx, t.dy, t.dw, t.dh);
			bm.close();
			loaded += 1;
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(LIMIT, tiles.length) }, () => work()),
	);
	if (!loaded) {
		post(null);
		return;
	}
	try {
		post(await canvas.convertToBlob({ type: "image/webp", quality }));
	} catch {
		post(null);
	}
};

export {};
