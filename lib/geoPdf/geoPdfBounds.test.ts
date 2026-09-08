import { degrees, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
	applyPageToGeo,
	extractGeoPdfBounds,
	extractGeoPdfLayout,
	fitPageToGeoAffine,
	type GeoBounds,
	type GeoRefPoint,
	pdfUsesJpxImages,
} from "./geoPdfBounds.js";

// ─── Test helper ─────────────────────────────────────────────────────────────
//
// Build a minimal synthetic GeoPDF in-memory with pdf-lib: one page plus an
// Adobe geospatial `/VP` viewport array. Saved with object streams (like real
// GIS exports) so the reader's decompression path is exercised too.

interface ViewportSpec {
	/** PDF rect [x1, y1, x2, y2] in user space. */
	bbox?: number[];
	/** [lat0, lon0, lat1, lon1, …] — lat FIRST, per spec. */
	gpts?: number[];
	/** [x0, y0, x1, y1, …] unit-square fractions of the BBox. */
	lpts?: number[];
}

async function makeGeoPdf(opts: {
	pageSize?: [number, number];
	cropBox?: [x: number, y: number, width: number, height: number];
	rotate?: number;
	viewports?: ViewportSpec[];
}): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const page = doc.addPage(opts.pageSize ?? [612, 792]);
	if (opts.cropBox) page.setCropBox(...opts.cropBox);
	if (opts.rotate) page.setRotation(degrees(opts.rotate));
	if (opts.viewports) {
		const vp = doc.context.obj(
			opts.viewports.map((v) => ({
				Type: "Viewport",
				...(v.bbox ? { BBox: v.bbox } : {}),
				Measure: {
					Type: "Measure",
					Subtype: "GEO",
					...(v.gpts ? { GPTS: v.gpts } : {}),
					...(v.lpts ? { LPTS: v.lpts } : {}),
				},
			})),
		);
		page.node.set(PDFName.of("VP"), vp);
	}
	return doc.save({ useObjectStreams: true });
}

// Frame registration shared by most cases: the map frame spans
// lat 50.0…50.5, lon −120.5…−120.0 (corner order ul, ll, lr, ur — lat first).
const GPTS = [50.5, -120.5, 50.0, -120.5, 50.0, -120.0, 50.5, -120.0];

/** Assert-and-narrow: fails the test on null, returns non-null bounds. */
function mustBounds(b: GeoBounds | null): GeoBounds {
	expect(b).not.toBeNull();
	if (!b) throw new Error("bounds were null");
	return b;
}

describe("extractGeoPdfBounds", () => {
	it("extrapolates a collared page to PAGE-extent bounds (not the frame extent)", async () => {
		// 612×792 page, map frame /BBox [72,200,540,720] — a title band above
		// and margins around, like every planting-access export.
		const bytes = await makeGeoPdf({
			viewports: [{ bbox: [72, 200, 540, 720], gpts: GPTS }],
		});
		const b = mustBounds(await extractGeoPdfBounds(bytes));
		// Hand-computed: degPerUnitX = 0.5/468, degPerUnitY = 0.5/520,
		// extrapolated from the frame rect out to the full page [0,0,612,792].
		expect(b.w).toBeCloseTo(-120.576923076923, 8);
		expect(b.e).toBeCloseTo(-119.923076923077, 8);
		expect(b.s).toBeCloseTo(49.807692307692, 8);
		expect(b.n).toBeCloseTo(50.569230769231, 8);
		// The regression this file exists for: page bounds must NOT be the raw
		// frame (GPTS) extent — that's the misplaced-overlay bug.
		expect(b.w).not.toBeCloseTo(-120.5, 4);
		expect(b.n).not.toBeCloseTo(50.5, 4);
	});

	it("is the identity when the frame fills the page (no collar)", async () => {
		const bytes = await makeGeoPdf({
			viewports: [{ bbox: [0, 0, 612, 792], gpts: GPTS }],
		});
		const b = mustBounds(await extractGeoPdfBounds(bytes));
		expect(b.w).toBeCloseTo(-120.5, 10);
		expect(b.e).toBeCloseTo(-120.0, 10);
		expect(b.s).toBeCloseTo(50.0, 10);
		expect(b.n).toBeCloseTo(50.5, 10);
	});

	it("honors an LPTS sub-rect of the BBox", async () => {
		// Georeferenced area = the middle 80% of the frame in both axes.
		const bytes = await makeGeoPdf({
			viewports: [
				{
					bbox: [0, 0, 612, 792],
					gpts: GPTS,
					lpts: [0.1, 0.9, 0.1, 0.1, 0.9, 0.1, 0.9, 0.9],
				},
			],
		});
		const b = mustBounds(await extractGeoPdfBounds(bytes));
		expect(b.w).toBeCloseTo(-120.5625, 10);
		expect(b.e).toBeCloseTo(-119.9375, 10);
		expect(b.s).toBeCloseTo(49.9375, 10);
		expect(b.n).toBeCloseTo(50.5625, 10);
	});

	it("respects a nonzero CropBox origin (renders only the cropped region)", async () => {
		const bytes = await makeGeoPdf({
			cropBox: [100, 100, 512, 692],
			viewports: [{ bbox: [72, 200, 540, 720], gpts: GPTS }],
		});
		const b = mustBounds(await extractGeoPdfBounds(bytes));
		expect(b.w).toBeCloseTo(-120.470085470085, 8);
		expect(b.e).toBeCloseTo(-119.923076923077, 8);
		expect(b.s).toBeCloseTo(49.903846153846, 8);
		expect(b.n).toBeCloseTo(50.569230769231, 8);
	});

	it("returns null for a rotated page (server path handles rotation)", async () => {
		const bytes = await makeGeoPdf({
			rotate: 90,
			viewports: [{ bbox: [72, 200, 540, 720], gpts: GPTS }],
		});
		expect(await extractGeoPdfBounds(bytes)).toBeNull();
	});

	it("returns null when there is no geospatial viewport", async () => {
		const bytes = await makeGeoPdf({});
		expect(await extractGeoPdfBounds(bytes)).toBeNull();
	});

	it("returns null for a degenerate LPTS instead of guessing the unit square", async () => {
		const bytes = await makeGeoPdf({
			viewports: [
				{
					bbox: [0, 0, 612, 792],
					gpts: GPTS,
					lpts: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
				},
			],
		});
		expect(await extractGeoPdfBounds(bytes)).toBeNull();
	});

	it("returns null when LPTS point count doesn't match GPTS", async () => {
		const bytes = await makeGeoPdf({
			viewports: [
				{
					bbox: [0, 0, 612, 792],
					gpts: GPTS,
					lpts: [0, 0, 0, 1, 1, 1],
				},
			],
		});
		expect(await extractGeoPdfBounds(bytes)).toBeNull();
	});

	it("returns null when extrapolation escapes the valid latitude range", async () => {
		// Frame nearly touches the pole; extrapolating the collar pushes the
		// page's north edge past +90° — implausible, so fall to the server.
		const nearPole = [90.0, -120.5, 89.6, -120.5, 89.6, -120.0, 90.0, -120.0];
		const bytes = await makeGeoPdf({
			viewports: [{ bbox: [72, 200, 540, 720], gpts: nearPole }],
		});
		expect(await extractGeoPdfBounds(bytes)).toBeNull();
	});

	it("returns null when a missing BBox makes extrapolation impossible", async () => {
		const bytes = await makeGeoPdf({ viewports: [{ gpts: GPTS }] });
		expect(await extractGeoPdfBounds(bytes)).toBeNull();
	});
});

// ─── JPEG 2000 detection ─────────────────────────────────────────────────────
//
// ArcMap exports the rendered basemap as /JPXDecode image strips that pdf.js
// can't decode — the instant on-device render drops the whole map body and
// shows only labels + legend. pdfUsesJpxImages lets importPdf skip that broken
// render and go straight to the server. See the July-2026 field report.

/** Build a PDF whose page draws an image XObject with the given /Filter name.
 *  We register a raw stream directly (pdf-lib has no high-level "add a
 *  JPEG2000 image" API) — the detector only reads the stream dict's /Filter,
 *  so the body bytes are irrelevant. */
async function makePdfWithImageFilter(filter: string): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.addPage([612, 792]);
	const stream = PDFRawStream.of(
		doc.context.obj({
			Type: "XObject",
			Subtype: "Image",
			Width: 16,
			Height: 16,
			BitsPerComponent: 8,
			ColorSpace: "DeviceRGB",
			Filter: filter,
		}),
		new Uint8Array([0, 0, 0, 0]),
	);
	doc.context.register(stream);
	return doc.save({ useObjectStreams: true });
}

describe("pdfUsesJpxImages", () => {
	it("detects a /JPXDecode image (the ArcMap JPEG2000 export)", async () => {
		const bytes = await makePdfWithImageFilter("JPXDecode");
		expect(await pdfUsesJpxImages(bytes)).toBe(true);
	});

	it("is false for a normal (non-JPEG2000) image PDF", async () => {
		const bytes = await makePdfWithImageFilter("DCTDecode");
		expect(await pdfUsesJpxImages(bytes)).toBe(false);
	});

	it("is false for a vector-only PDF (no images at all)", async () => {
		const bytes = await makeGeoPdf({
			viewports: [{ bbox: [0, 0, 612, 792], gpts: GPTS }],
		});
		expect(await pdfUsesJpxImages(bytes)).toBe(false);
	});

	it("never throws on garbage input — returns false", async () => {
		expect(await pdfUsesJpxImages(new Uint8Array([1, 2, 3, 4]))).toBe(false);
	});
});

// ─── Rotation-true placement: gcps + fitPageToGeoAffine ──────────────────────
//
// These pin the math that decides WHERE every crisp label and quad corner
// lands. The flat
// `bounds` mapping alone drifts labels by rotation × distance-from-anchor —
// the 400–600 m field bug on the West Fraser sheet — because the raster sits
// on the true rotated quad. And the ArcGIS /LPTS y-axis trap: ArcGIS writes
// LPTS y TOP-DOWN, the spec reads bottom-up; the wrong reading is a vertical
// mirror an affine fits with ZERO residual, so only the orientation prior
// (no mirror, near-north-up) can tell them apart.

/** Truth model: a sheet rotated 10° ccw around (50.25, −120.25), 28 m/pt,
 *  frame centred at page (306, 396) — the QA fixture geometry. */
function rotatedTruth(x: number, y: number): [number, number] {
	const th = (10 * Math.PI) / 180;
	const mLat = 110_540;
	const mLng = 110_540 * Math.cos((50.25 * Math.PI) / 180);
	const lx = (x - 306) * 28;
	const ly = (y - 396) * 28;
	const X = lx * Math.cos(th) - ly * Math.sin(th);
	const Y = lx * Math.sin(th) + ly * Math.cos(th);
	return [-120.25 + X / mLng, 50.25 + Y / mLat];
}

/** GPTS array ([lat, lng] pairs) for page points, via the truth model. */
function gptsFor(pagePts: Array<[number, number]>): number[] {
	return pagePts.flatMap(([x, y]) => {
		const [lng, lat] = rotatedTruth(x, y);
		return [lat, lng];
	});
}

const FRAME = [40, 40, 572, 752];
// Frame corners in ll, ul, ur, lr order — matches spec LPTS [0,0 0,1 1,1 1,0].
const FRAME_CORNERS: Array<[number, number]> = [
	[40, 40],
	[40, 752],
	[572, 752],
	[572, 40],
];
const SPEC_LPTS = [0, 0, 0, 1, 1, 1, 1, 0]; // ll, ul, ur, lr — bottom-up y

describe("fitPageToGeoAffine", () => {
	const gcpsFromTruth = (pts: Array<[number, number]>): GeoRefPoint[] =>
		pts.map(([x, y]) => {
			const [lng, lat] = rotatedTruth(x, y);
			return { x, y, lng, lat };
		});

	it("recovers a rotated sheet's transform to sub-metre accuracy", () => {
		const t = fitPageToGeoAffine(gcpsFromTruth(FRAME_CORNERS));
		expect(t).not.toBeNull();
		// Probe an interior point the corners never state explicitly.
		if (!t) throw new Error("unreachable");
		const [lng, lat] = applyPageToGeo(t, 306, 396);
		const [elng, elat] = rotatedTruth(306, 396);
		expect(lng).toBeCloseTo(elng, 6);
		expect(lat).toBeCloseTo(elat, 6);
	});

	it("rejects fewer than 3 points and collinear points", () => {
		expect(fitPageToGeoAffine(gcpsFromTruth([FRAME_CORNERS[0]]))).toBeNull();
		expect(
			fitPageToGeoAffine(gcpsFromTruth([FRAME_CORNERS[0], FRAME_CORNERS[1]])),
		).toBeNull();
		expect(
			fitPageToGeoAffine(
				gcpsFromTruth([
					[40, 40],
					[300, 40],
					[572, 40],
				]),
			),
		).toBeNull();
	});

	it("rejects a fit whose residual exceeds the guard (bad point data)", () => {
		// 5 points, one shoved ~2 km north: LSQ can't absorb it, the residual
		// blows past max(30 m, 1% diag) and the fit must refuse to ship.
		const pts = gcpsFromTruth([...FRAME_CORNERS, [306, 396]]);
		pts[4] = { ...pts[4], lat: pts[4].lat + 0.02 };
		expect(fitPageToGeoAffine(pts)).toBeNull();
	});
});

describe("extractGeoPdfLayout — gcps orientation + viewport priority", () => {
	/** Fit the layout's gcps and fail loudly if either step comes back null. */
	async function mustAffine(bytes: Uint8Array) {
		const layout = await extractGeoPdfLayout(bytes);
		expect(layout).not.toBeNull();
		if (!layout) throw new Error("layout was null");
		expect(layout.gcps).toHaveLength(4);
		const t = fitPageToGeoAffine(layout.gcps);
		expect(t).not.toBeNull();
		if (!t) throw new Error("affine was null");
		return { layout, t };
	}

	it("spec-convention LPTS on a rotated sheet → affine matches truth", async () => {
		const bytes = await makeGeoPdf({
			viewports: [
				{ bbox: FRAME, gpts: gptsFor(FRAME_CORNERS), lpts: SPEC_LPTS },
			],
		});
		const { t } = await mustAffine(bytes);
		const [lng, lat] = applyPageToGeo(t, 306, 396);
		const [elng, elat] = rotatedTruth(306, 396);
		expect(lng).toBeCloseTo(elng, 6);
		expect(lat).toBeCloseTo(elat, 6);
	});

	it("ArcGIS top-down LPTS (the West Fraser shape) → flip resolves, no mirror", async () => {
		// ArcGIS pairing: LPTS y grows DOWNWARD, so its (0,1) is the page
		// BOTTOM-left. Same geo corners, paired the ArcGIS way.
		const arcgisLpts = [0, 1, 0, 0, 1, 0, 1, 1];
		const arcgisPagePts: Array<[number, number]> = [
			[40, 40], // written (0,1): top-down ⇒ page bottom-left
			[40, 752], // written (0,0): top-down ⇒ page top-left
			[572, 752],
			[572, 40],
		];
		const bytes = await makeGeoPdf({
			viewports: [
				{ bbox: FRAME, gpts: gptsFor(arcgisPagePts), lpts: arcgisLpts },
			],
		});
		const { t } = await mustAffine(bytes);
		// The acid test: page-top must map NORTH of page-bottom (no mirror)…
		const [, latTop] = applyPageToGeo(t, 306, 752);
		const [, latBot] = applyPageToGeo(t, 306, 40);
		expect(latTop).toBeGreaterThan(latBot);
		// …and the resolved transform matches truth, not just "some" transform.
		const [lng, lat] = applyPageToGeo(t, 306, 396);
		const [elng, elat] = rotatedTruth(306, 396);
		expect(lng).toBeCloseTo(elng, 6);
		expect(lat).toBeCloseTo(elat, 6);
	});

	it("pairing that mirrors BOTH ways → gcps empty, bounds still usable", async () => {
		// East/west swapped: neither the as-written nor the y-flipped reading
		// is non-mirrored + near-north-up, so gcps must come back EMPTY —
		// labels fall back to the flat mapping instead of shipping garbage.
		const mirroredPagePts: Array<[number, number]> = [
			[572, 40], // claims to be ll
			[572, 752],
			[40, 752],
			[40, 40],
		];
		const bytes = await makeGeoPdf({
			viewports: [
				{ bbox: FRAME, gpts: gptsFor(mirroredPagePts), lpts: SPEC_LPTS },
			],
		});
		const layout = await extractGeoPdfLayout(bytes);
		expect(layout).not.toBeNull();
		expect(layout?.gcps).toHaveLength(0);
		expect((layout?.bounds.n ?? 0) > (layout?.bounds.s ?? 0)).toBe(true);
	});

	it("no LPTS + 4-point GPTS → spec-default corner order still fits truth", async () => {
		const bytes = await makeGeoPdf({
			viewports: [{ bbox: FRAME, gpts: gptsFor(FRAME_CORNERS) }],
		});
		const { t } = await mustAffine(bytes);
		const [lng, lat] = applyPageToGeo(t, 100, 100);
		const [elng, elat] = rotatedTruth(100, 100);
		expect(lng).toBeCloseTo(elng, 6);
		expect(lat).toBeCloseTo(elat, 6);
	});

	it("locator inset listed FIRST cannot hijack the georef (largest BBox wins)", async () => {
		// Tiny inset viewport spanning 3.5° of latitude (a province locator),
		// listed BEFORE the real frame — the real West Fraser sheet's shape.
		const inset: ViewportSpec = {
			bbox: [500, 600, 590, 700],
			gpts: [54.5, -119, 58, -119, 58, -111.5, 54.5, -111.5],
			lpts: SPEC_LPTS,
		};
		const main: ViewportSpec = {
			bbox: FRAME,
			gpts: gptsFor(FRAME_CORNERS),
			lpts: SPEC_LPTS,
		};
		const bytes = await makeGeoPdf({ viewports: [inset, main] });
		const layout = await extractGeoPdfLayout(bytes);
		expect(layout).not.toBeNull();
		// Bounds must extrapolate from the MAIN frame (≈ half a degree of
		// latitude), not the inset (3.5° tall → page extent would blow far
		// past a degree).
		expect((layout?.bounds.n ?? 99) - (layout?.bounds.s ?? 0)).toBeLessThan(1);
	});

	it("partial LPTS + ArcGIS flip → frame rect lands on the TRUE sub-rect", async () => {
		// Georeferenced area = the BOTTOM 60% of the BBox, written top-down
		// (LPTS y ∈ [0.4, 1]). If the flip didn't also mirror the LPTS extent,
		// the frame would land on the TOP 60% — collar text would leak in and
		// the bounds anchor would shift.
		const subPagePts: Array<[number, number]> = [
			[40, 40], // written (0, 1): bottom-left
			[40, 467.2], // written (0, 0.4): 60% up
			[572, 467.2],
			[572, 40],
		];
		const arcgisSubLpts = [0, 1, 0, 0.4, 1, 0.4, 1, 1];
		const bytes = await makeGeoPdf({
			viewports: [
				{ bbox: FRAME, gpts: gptsFor(subPagePts), lpts: arcgisSubLpts },
			],
		});
		const layout = await extractGeoPdfLayout(bytes);
		expect(layout).not.toBeNull();
		expect(layout?.gcps).toHaveLength(4);
		// Frame must be the BOTTOM band of the BBox: y from 40 up to ~467.
		expect(layout?.frame.minY).toBeCloseTo(40, 0);
		expect(layout?.frame.maxY).toBeCloseTo(467.2, 0);
	});
});
