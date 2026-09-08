// On-device PDF → WebP raster, via pdf.js. The "show it instantly" half of the
// instant-render import: the file is already on the phone, so we rasterize page
// 1 to a WebP blob locally (no network) and mount it as the overlay imagery the
// moment the file is picked. The server then bakes a smaller, reprojected WebP
// in the background and we swap it in (mapStore.updateOverlay → no-blink
// updateImage).
//
// pdf.js is lazy: this module is itself dynamically imported by importPdf, so
// the ~1 MB engine + its worker only load when a PDF is actually imported, never
// in the main bundle. Reviving pdf.js (removed 2026-05-23) for raster ONLY — no
// proj4, no on-device georef math; georef comes from geoPdfBounds.ts.

import * as pdfjsLib from "pdfjs-dist";
// Vite bundles the worker and hands back a served URL (same pattern as
// sqlite3.wasm?url in tinyStore.ts). pdf.js needs an explicit workerSrc or it
// throws "No GlobalWorkerOptions.workerSrc specified".
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;
/** Configure pdf.js's worker exactly once. Exported so every pdf.js consumer
 *  (rasterizePdf, pdfTextLabels) shares the one wiring instead of each
 *  re-importing the worker URL. */
export function ensureWorker(): void {
	if (workerConfigured) return;
	pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
	// iOS Safari has NEVER shipped ReadableStream async iteration, and pdf.js
	// getTextContent() does `for await (…of stream)` — on a real iPhone that
	// throws "TypeError: undefined is not a function (near '…value of
	// readableStream…')" and silently costs every crisp label (rendering is
	// unaffected — it doesn't iterate streams). Desktop Chrome AND Playwright's
	// WebKit trunk both have it, which is exactly why device testing missed
	// this. Minimal spec-shaped shim, installed only where missing.
	const rsProto = ReadableStream.prototype as unknown as Record<
		symbol,
		unknown
	>;
	if (!rsProto[Symbol.asyncIterator]) {
		rsProto[Symbol.asyncIterator] = function (this: ReadableStream) {
			const reader = this.getReader();
			return {
				next: () => reader.read(),
				return: async (value?: unknown) => {
					await reader.cancel();
					return { done: true as const, value };
				},
				[Symbol.asyncIterator]() {
					return this;
				},
			};
		};
	}
	workerConfigured = true;
}

export interface RasterResult {
	blob: Blob;
	widthPx: number;
	heightPx: number;
}

/**
 * Rasterize page 1 of a PDF to a WebP blob. `maxEdgePx` caps the longest edge
 * (downscale only, never upscale) so a huge GeoPDF doesn't blow out canvas RAM;
 * the raw local raster is intentionally generous (the user sees the full-detail
 * version first, then the optimized server WebP swaps in). Throws on any pdf.js
 * failure so the caller can fall back to the server-only path.
 */
export async function rasterizePdfToWebp(
	bytes: Uint8Array,
	opts: { maxEdgePx?: number; quality?: number } = {},
): Promise<RasterResult> {
	const maxEdge = opts.maxEdgePx ?? 3000;
	const quality = opts.quality ?? 0.82;
	ensureWorker();
	// pdf.js detaches the buffer it's handed — clone so the caller's bytes stay
	// intact for the background server convert.
	const data = bytes.slice();
	const loadingTask = pdfjsLib.getDocument({ data });
	const doc = await loadingTask.promise;
	try {
		const page = await doc.getPage(1);
		const base = page.getViewport({ scale: 1 });
		const longest = Math.max(base.width, base.height);
		const scale = longest > maxEdge ? maxEdge / longest : 1;
		const viewport = page.getViewport({ scale });
		const widthPx = Math.ceil(viewport.width);
		const heightPx = Math.ceil(viewport.height);
		const canvas = document.createElement("canvas");
		canvas.width = widthPx;
		canvas.height = heightPx;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2d canvas context unavailable");
		// Paint the page onto SOLID WHITE, not the canvas's default
		// transparency. Forestry PDFs are opaque paper: the legend/collar panel
		// has no fill of its own and relies on the page's white paper. A fresh
		// canvas is transparent and pdf.js paints no page background, so without
		// this the legend renders see-through → black over the dark map,
		// unreadable. Mirrors the server's `-oo BANDS=3` white-background render
		// so this instant local raster matches the optimized WebP that swaps in
		// later. See importPdf.ts.
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, widthPx, heightPx);
		await page.render({ canvas, viewport }).promise;
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(b) =>
					b ? resolve(b) : reject(new Error("canvas.toBlob returned null")),
				"image/webp",
				quality,
			);
		});
		// Release the canvas backing store promptly — iOS WebKit is stingy with
		// large canvases and won't GC it for a while otherwise.
		canvas.width = 0;
		canvas.height = 0;
		return { blob, widthPx, heightPx };
	} finally {
		await loadingTask.destroy();
	}
}
