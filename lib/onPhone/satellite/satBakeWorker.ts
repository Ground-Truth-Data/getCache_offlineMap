/// <reference lib="webworker" />
// satBakeWorker.ts — the satellite compositor, off the UI thread; falls back to the main thread in satelliteImage.ts where OffscreenCanvas/convertToBlob aren't available.

type TileDraw = { buf: ArrayBuffer; dx: number; dy: number; dw: number; dh: number };
type BakeReq = {
	id: number;
	tiles: TileDraw[];
	w: number;
	h: number;
	quality: number;
};
type BakeRes = { id: number; blob: Blob | null; loaded: number };

self.onmessage = async (e: MessageEvent<BakeReq>): Promise<void> => {
	const { id, tiles, w, h, quality } = e.data;
	let loaded = 0;
	const post = (blob: Blob | null): void => {
		const res: BakeRes = { id, blob, loaded };
		(self as unknown as Worker).postMessage(res);
	};
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		post(null);
		return;
	}
	for (const t of tiles) {
		const bm = await createImageBitmap(new Blob([t.buf])).catch(() => null);
		if (!bm) continue; // gap → transparent → jagged mask
		ctx.drawImage(bm, t.dx, t.dy, t.dw, t.dh);
		bm.close();
		loaded += 1;
	}
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
