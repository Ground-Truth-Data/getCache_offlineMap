// Crisp-label extraction — the "Avenza leg-up".
//
// GIS-exported PDFs (ArcGIS planting access maps) store their labels as REAL
// TEXT OBJECTS, not pixels. We read them on-device with pdf.js
// getTextContent() — every string with its exact page position — project each
// through the same georef math the raster overlay uses (geoPdfBounds), and
// re-render them as a Mapbox symbol layer over the raster: real font, sharp at
// every zoom, while the raster lines behind them soften. This works even for
// the JPX/ArcMap PDFs whose IMAGES pdf.js can't decode — the text layer is
// separate from the broken basemap strips, so the grainiest server-converted
// maps are exactly the ones that still get crisp labels.
//
// OCR is deliberately NOT here: it's only needed for scanned/flattened PDFs
// and would guess where this reads exactly. If a PDF has no text layer, this
// returns an empty list and the overlay simply ships without crisp labels.

import {
	applyPageToGeo,
	extractGeoPdfLayout,
	fitPageToGeoAffine,
} from "./geoPdfBounds";

/** Diagnostics the HOST owns. A child may not reach into a parent, so the two
 *  sinks are injected and default to no-ops: extraction runs identically with
 *  no host attached, it just says nothing. */
export interface LabelPorts {
	devlog?: (entry: Record<string, unknown>) => void;
	reportSwallowed?: (tag: string, error: unknown) => void;
}

let ports: LabelPorts = {};

/** Called once by the host at boot. Never required. */
export function setLabelPorts(p: LabelPorts): void {
	ports = p;
}

const devlog = (entry: Record<string, unknown>) => ports.devlog?.(entry);
const reportSwallowed = (tag: string, error: unknown) =>
	ports.reportSwallowed?.(tag, error);

/** One map label, ready to render. Persisted (compact keys — hundreds ride in
 *  one mapFeatureTable cell) alongside overlayBounds; see mapStore
 *  serializeOverlayBounds. */
export interface OverlayLabel {
	/** The text itself, e.g. "2427". */
	t: string;
	/** Label centre as [lng, lat]. */
	p: [number, number];
	/** Text height in ground METRES — lets the renderer scale the font with
	 *  zoom exactly like the raster underneath (mounted, not HUD-fixed). */
	m: number;
	/** Rotation in degrees clockwise (Mapbox text-rotate, map-aligned). */
	r: number;
}

/** Labels above this count are dropped (longest-first keeps the big block
 *  numbers). A contour-label-dense sheet can carry thousands of tiny strings;
 *  they'd bloat the row cell and the symbol layer for no legibility win. */
const MAX_LABELS = 800;
/** Skip runt strings taller than the map can meaningfully show — under ~4 PDF
 *  units (~5px at 150 dpi) the raster original is an unreadable smear anyway
 *  and the crisp copy would just be confetti. */
const MIN_FONT_UNITS = 4;
const MAX_LABEL_CHARS = 40;

const METERS_PER_DEG_LAT = 110_540;

/**
 * Extract the map-frame text labels from a GeoPDF's bytes, projected to
 * WGS84. Returns [] when the PDF has no text layer inside its map frame, and
 * null when it isn't an on-device-readable GeoPDF at all (no layout). Never
 * throws.
 */
export async function extractPdfMapLabels(
	bytes: Uint8Array,
): Promise<OverlayLabel[] | null> {
	try {
		const layout = await extractGeoPdfLayout(bytes);
		devlog({ evt: "labels-layout", ok: !!layout, gcps: layout?.gcps.length });
		if (!layout) return null;
		const { bounds, crop, frame } = layout;
		const cropW = crop.maxX - crop.minX;
		const cropH = crop.maxY - crop.minY;
		if (cropW <= 0 || cropH <= 0) return null;

		// Rotation-true projection. The affine (fitted through the GPTS↔page
		// point pairs) carries the sheet's rotation; the axis-aligned bounds
		// mapping below is the FALLBACK only — on a rotated sheet it drifts
		// labels by rotation × distance-from-anchor (the 400–600 m field bug),
		// because the raster is placed on the true rotated quad.
		const affine = fitPageToGeoAffine(layout.gcps);
		const midLat = (bounds.n + bounds.s) / 2;
		const mLat = METERS_PER_DEG_LAT;
		const mLng = METERS_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);

		// Reuse rasterizePdf's pdf.js worker wiring — configured exactly once
		// for both paths.
		const [pdfjsLib, { ensureWorker }] = await Promise.all([
			import("pdfjs-dist"),
			import("./rasterizePdf"),
		]);
		ensureWorker();
		const task = pdfjsLib.getDocument({ data: bytes.slice() });
		const doc = await task.promise;
		try {
			const page = await doc.getPage(1);
			const content = await page.getTextContent();
			devlog({ evt: "labels-items", n: content.items.length });
			const out: OverlayLabel[] = [];
			for (const item of content.items) {
				if (!("str" in item)) continue; // TextMarkedContent — no text
				const t = item.str.trim();
				if (!t || t.length > MAX_LABEL_CHARS) continue;
				// transform = [a, b, c, d, e, f] in y-up PDF user space;
				// (e, f) is the baseline-left origin.
				const [a, b, c, d, ox, oy] = item.transform as number[];
				const fontH = Math.hypot(c, d);
				if (!Number.isFinite(fontH) || fontH < MIN_FONT_UNITS) continue;
				const angle = Math.atan2(b, a);
				// Centre of the run: half the advance width along the baseline,
				// ~a third of the font height up from it (baseline → optical
				// middle), both rotated with the text.
				const dx = (item.width ?? 0) / 2;
				const dy = fontH * 0.32;
				const cos = Math.cos(angle);
				const sin = Math.sin(angle);
				const cx = ox + dx * cos - dy * sin;
				const cy = oy + dx * sin + dy * cos;
				// Only text ON the map: inside the georeferenced frame rect.
				// Collar text (title, legend, grid coordinates) lives outside.
				if (
					cx < frame.minX ||
					cx > frame.maxX ||
					cy < frame.minY ||
					cy > frame.maxY
				)
					continue;
				let lng: number;
				let lat: number;
				let m: number;
				let r: number;
				if (affine) {
					[lng, lat] = applyPageToGeo(affine, cx, cy);
					// Map the text's own page-space vectors through the affine's
					// linear part: (a,b) is the baseline direction, (c,d) the
					// full-font-height up vector — so rotation AND ground size
					// both inherit the sheet's true orientation.
					const bLng = affine.a * a + affine.b * b;
					const bLat = affine.d * a + affine.e * b;
					r = (-Math.atan2(bLat * mLat, bLng * mLng) * 180) / Math.PI;
					const uLng = affine.a * c + affine.b * d;
					const uLat = affine.d * c + affine.e * d;
					m = Math.hypot(uLng * mLng, uLat * mLat);
				} else {
					const u = (cx - crop.minX) / cropW;
					const v = (cy - crop.minY) / cropH; // y-up: v=0 is south
					lng = bounds.w + u * (bounds.e - bounds.w);
					lat = bounds.s + v * (bounds.n - bounds.s);
					m = (fontH / cropH) * (bounds.n - bounds.s) * METERS_PER_DEG_LAT;
					r = (-angle * 180) / Math.PI;
				}
				if (![lng, lat, m].every(Number.isFinite) || m <= 0) continue;
				out.push({ t, p: [lng, lat], m, r });
			}
			if (out.length > MAX_LABELS) {
				// No silent caps: say what we dropped. Keep the physically
				// largest labels — block numbers, road names — drop confetti.
				console.info(
					`[pdfTextLabels] ${out.length} labels; keeping largest ${MAX_LABELS}`,
				);
				out.sort((x, y) => y.m - x.m);
				out.length = MAX_LABELS;
			}
			devlog({ evt: "labels-out", n: out.length });
			return out;
		} finally {
			void task.destroy();
		}
	} catch (e) {
		// This swallow used to be a bare console.warn — invisible on a real
		// device, which hid the phone-labels failure for a day. Operator
		// report + dev tap, never fails the import.
		reportSwallowed("pdfTextLabels:extract", e);
		return null;
	}
}
