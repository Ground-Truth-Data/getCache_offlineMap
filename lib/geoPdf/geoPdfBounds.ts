// On-device GeoPDF georeferencing → overlay bounds, WITHOUT the server.
//
// A georeferenced PDF (the kind planters export from a GIS) carries its
// geographic registration inside the file: an Adobe ISO-32000 "geospatial"
// Viewport whose `/Measure` dictionary holds a `/GPTS` array — the lat/lon of
// the map FRAME's corners. The frame (`/VP` `/BBox`) is only part of the page:
// planting maps carry a collar (title band, legend panel) around it, and
// rasterizePdf.ts rasterizes the WHOLE page. So we extrapolate the GPTS extent
// from the frame rect out to the full rendered page rect (the CropBox) and
// return PAGE-extent bounds — the same shape the server computes off its
// whole warped raster, so the later optimize-swap doesn't move the map.
//
// We use pdf-lib purely as an object-graph reader: the `/Measure` dict lives in
// a compressed object stream (a plain byte-grep can't reach it), and pdf-lib
// decompresses + exposes the indirect-object tree on the main thread. We do NOT
// rasterize here (that's rasterizePdf.ts / pdf.js) and we never mutate the file.
//
// Scope: north-up Adobe GeoPDFs with `/Rotate 0` (checked — rotated pages
// return null), the overwhelmingly common planter export. `/GPTS` is
// geographic lat/lon per the spec. The `bounds` are axis-aligned extents (fine
// for framing/zoom), but the layout ALSO carries the raw GPTS↔page point pairs
// (`gcps`) + `fitPageToGeoAffine`, which preserve the sheet's true rotation —
// required for label placement and quad corners; the flat bounds alone put
// labels hundreds of metres off on a rotated sheet. Anything we can't place
// confidently returns null → the caller falls back to the server bounds
// (correct, just not instant).

import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFNumber,
	type PDFPage,
	PDFRawStream,
} from "pdf-lib";

export interface GeoBounds {
	n: number;
	s: number;
	e: number;
	w: number;
}

/** Axis-aligned rect in PDF user space (origin bottom-left, y-up). */
export interface Rect {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

// LPTS values are unit-square fractions; allow this much slop outside [0,1]
// (real exporters emit e.g. -0.0001) and require at least this much extent.
const LPTS_EPSILON = 0.01;

// A collar is 10–40% of a page. If extrapolation blows the geographic span up
// past this multiple of the frame span, the BBox/LPTS numbers are garbage.
const MAX_EXTRAPOLATION_FACTOR = 4;

function num(x: unknown): number {
	if (x instanceof PDFNumber) return x.asNumber();
	const n = Number((x as { toString(): string })?.toString?.());
	return Number.isFinite(n) ? n : Number.NaN;
}

function plausible(b: GeoBounds): boolean {
	return (
		[b.n, b.s, b.e, b.w].every(Number.isFinite) &&
		b.n > b.s &&
		b.e > b.w &&
		Math.abs(b.n) <= 90 &&
		Math.abs(b.s) <= 90 &&
		Math.abs(b.e) <= 180 &&
		Math.abs(b.w) <= 180
	);
}

/** Normalize an {x,y,width,height} box (pdf-lib rect) into min/max corners —
 *  malformed PDFs can carry negative widths/heights. */
function normBox(box: {
	x: number;
	y: number;
	width: number;
	height: number;
}): Rect | null {
	const x2 = box.x + box.width;
	const y2 = box.y + box.height;
	const r: Rect = {
		minX: Math.min(box.x, x2),
		minY: Math.min(box.y, y2),
		maxX: Math.max(box.x, x2),
		maxY: Math.max(box.y, y2),
	};
	if (![r.minX, r.minY, r.maxX, r.maxY].every(Number.isFinite)) return null;
	return r;
}

/** Normalize a 4-number PDF rectangle array [x1 y1 x2 y2] into min/max corners. */
function normRect4(vals: number[]): Rect | null {
	if (vals.length !== 4 || !vals.every(Number.isFinite)) return null;
	return {
		minX: Math.min(vals[0], vals[2]),
		minY: Math.min(vals[1], vals[3]),
		maxX: Math.max(vals[0], vals[2]),
		maxY: Math.max(vals[1], vals[3]),
	};
}

function intersect(a: Rect, b: Rect): Rect | null {
	const r: Rect = {
		minX: Math.max(a.minX, b.minX),
		minY: Math.max(a.minY, b.minY),
		maxX: Math.min(a.maxX, b.maxX),
		maxY: Math.min(a.maxY, b.maxY),
	};
	return r.maxX > r.minX && r.maxY > r.minY ? r : null;
}

/** Axis-aligned extent of paired values. `firstIsY` flips the pair order:
 *  GPTS pairs are (lat, lon) — lat FIRST; LPTS pairs are (x, y). Loop instead
 *  of Math.min(...spread) — a hostile/degenerate PDF can carry an arbitrarily
 *  long array, the arg-count RangeError class the arg-spread guard forbids. */
function pairExtent(vals: number[], firstIsY: boolean): Rect | null {
	if (vals.length < 4 || vals.length % 2 !== 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i + 1 < vals.length; i += 2) {
		const x = firstIsY ? vals[i + 1] : vals[i];
		const y = firstIsY ? vals[i] : vals[i + 1];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const r: Rect = { minX, minY, maxX, maxY };
	if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
	return r;
}

/** One ground-control point: a page user-space position paired with the
 *  geographic coordinate the georef registers it to. These preserve what the
 *  axis-aligned `bounds` throw away — the sheet's rotation/skew. */
export interface GeoRefPoint {
	x: number;
	y: number;
	lng: number;
	lat: number;
}

/** Full on-device georef layout for a page — the geographic bounds PLUS the
 *  two user-space rects they were derived from. `crop` is what pdf.js renders
 *  (the raster + `bounds` correspond to it 1:1); `frame` is the georeferenced
 *  map-frame rect (the /VP BBox, LPTS-narrowed) — page content inside `frame`
 *  is ON the map, content outside it is collar (title, legend, scale bar).
 *  `gcps` are the raw GPTS↔page point pairs (empty when the pairing can't be
 *  trusted) — feed them to `fitPageToGeoAffine` for rotation-true placement. */
export interface GeoPdfLayout {
	bounds: GeoBounds;
	crop: Rect;
	frame: Rect;
	gcps: GeoRefPoint[];
}

/** Read one page's geospatial viewports and reduce the first trustworthy one
 *  to axis-aligned PAGE-extent [w,s,e,n] bounds (GPTS frame extent extrapolated
 *  out to the rendered CropBox). Returns null when the page carries no
 *  geospatial viewport we can place confidently. */
function boundsFromPage(page: PDFPage): GeoPdfLayout | null {
	// Rotated pages: pdf.js renders them rotated, our y-up math doesn't. Bail
	// to the server path, which warps rotation away properly.
	if (page.getRotation().angle % 360 !== 0) return null;

	// What pdf.js rasterizes: the CropBox clipped to the MediaBox (pdf-lib
	// already inherits CropBox up the page tree and falls back to MediaBox).
	const media = normBox(page.getMediaBox());
	const cropRaw = normBox(page.getCropBox());
	if (!media || !cropRaw) return null;
	const crop = intersect(cropRaw, media);
	if (!crop) return null;

	const vp = page.node.lookup(PDFName.of("VP"));
	if (!(vp instanceof PDFArray)) return null;
	// Evaluate the LARGEST viewport first: real sheets carry a second /VP for
	// the little locator-inset map — in listed order an inset-first export
	// would register the whole page to the inset's georef.
	const order: Array<{ i: number; area: number }> = [];
	for (let i = 0; i < vp.size(); i++) {
		const viewport = vp.lookup(i);
		if (!(viewport instanceof PDFDict)) continue;
		let area = 0;
		try {
			const bb = viewport.lookupMaybe(PDFName.of("BBox"), PDFArray);
			const r = bb ? normRect4(bb.asArray().map(num)) : null;
			if (r) area = (r.maxX - r.minX) * (r.maxY - r.minY);
		} catch {
			// Malformed BBox: rank it last, let the main loop's own guards
			// decide — a pre-scan hiccup must not abort the whole extraction.
		}
		order.push({ i, area });
	}
	order.sort((p, q) => q.area - p.area);
	for (const { i } of order) {
		// Untyped lookup + instanceof: the typed PDFArray/PDFDict `lookup`
		// THROWS on a missing/mismatched key, which would abort the whole
		// extraction instead of skipping this viewport.
		const viewport = vp.lookup(i);
		if (!(viewport instanceof PDFDict)) continue;
		const measure = viewport.lookupMaybe(PDFName.of("Measure"), PDFDict);
		if (!measure) continue;
		const gpts = measure.lookupMaybe(PDFName.of("GPTS"), PDFArray);
		if (!gpts) continue;
		const gptsVals = gpts.asArray().map(num);
		// GPTS = [lat0, lon0, lat1, lon1, …] — geographic, lat FIRST.
		const geo = pairExtent(gptsVals, true);
		if (!geo || geo.maxX <= geo.minX || geo.maxY <= geo.minY) continue;

		// The frame rect the GPTS extent registers to: the viewport /BBox,
		// spec-required, same user space as the CropBox.
		const bboxArr = viewport.lookupMaybe(PDFName.of("BBox"), PDFArray);
		if (!bboxArr) continue;
		const bbox = normRect4(bboxArr.asArray().map(num));
		if (!bbox) continue;

		// Optional /LPTS narrows the georeferenced area to a sub-rect of the
		// BBox (unit-square (x,y) fractions; absent = the whole BBox). A
		// degenerate LPTS skips the viewport — guessing the unit square here
		// would re-create the misplacement bug. [[no-silent-fallbacks]]
		let unit: Rect = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
		// Per-point LPTS unit coords, kept in GPTS pairing order — this ordering
		// IS the sheet's rotation (pairExtent above deliberately flattens it for
		// the axis-aligned bounds; the gcps below preserve it for the affine).
		let lptsPts: Array<[number, number]> | null = null;
		const lpts = measure.lookupMaybe(PDFName.of("LPTS"), PDFArray);
		if (lpts) {
			const lptsVals = lpts.asArray().map(num);
			if (lptsVals.length !== gptsVals.length) continue;
			const l = pairExtent(lptsVals, false);
			if (
				!l ||
				l.minX < -LPTS_EPSILON ||
				l.minY < -LPTS_EPSILON ||
				l.maxX > 1 + LPTS_EPSILON ||
				l.maxY > 1 + LPTS_EPSILON ||
				l.maxX - l.minX < LPTS_EPSILON ||
				l.maxY - l.minY < LPTS_EPSILON
			)
				continue;
			unit = l;
			lptsPts = [];
			for (let j = 0; j + 1 < lptsVals.length; j += 2)
				lptsPts.push([lptsVals[j], lptsVals[j + 1]]);
		} else if (gptsVals.length === 8) {
			// No LPTS: the spec default pairs the 4 GPTS points with the BBox
			// corners in ll, ul, ur, lr order. That's a CONVENTION, not data —
			// gcpsTrustworthy() below rejects the fit if a nonstandard exporter
			// ordered them differently (a wrong pairing fits a mirror/quarter-turn
			// with ZERO residual, so it can't be caught by residuals alone).
			lptsPts = [
				[0, 0],
				[0, 1],
				[1, 1],
				[1, 0],
			];
		}

		// Ground-control points: page position ↔ geographic coordinate, pairing
		// preserved. Resolve the LPTS y-axis convention FIRST — the same flip
		// that fixes the pairing decides WHERE the LPTS sub-rect sits in the
		// BBox, so the frame/bounds below must use the resolved orientation.
		// LPTS fractions are of the BBox (not the LPTS sub-rect).
		let gcps: GeoRefPoint[] = [];
		let lptsFlipped = false;
		if (lptsPts) {
			const bw = bbox.maxX - bbox.minX;
			const bh = bbox.maxY - bbox.minY;
			for (let j = 0; j < lptsPts.length; j++) {
				const lat = gptsVals[j * 2];
				const lng = gptsVals[j * 2 + 1];
				const [lx, ly] = lptsPts[j];
				const x = bbox.minX + lx * bw;
				const y = bbox.minY + ly * bh;
				if ([x, y, lng, lat].every(Number.isFinite))
					gcps.push({ x, y, lng, lat });
			}
			if (gcps.length !== lptsPts.length) gcps = [];
			else {
				const oriented = orientGcps(gcps, bbox);
				gcps = oriented?.gcps ?? [];
				lptsFlipped = oriented?.flipped ?? false;
			}
		}
		if (lptsFlipped) {
			// The top-down convention won: mirror the LPTS extent too, so the
			// frame rect (collar filter) and the bounds extrapolation anchor on
			// the sub-rect's TRUE position. A full-square LPTS (the common case)
			// is flip-symmetric, so this only matters for partial sub-rects.
			unit = {
				minX: unit.minX,
				maxX: unit.maxX,
				minY: 1 - unit.maxY,
				maxY: 1 - unit.minY,
			};
		}

		// Georeferenced rect G in user space = LPTS sub-rect of the BBox.
		const g: Rect = {
			minX: bbox.minX + unit.minX * (bbox.maxX - bbox.minX),
			maxX: bbox.minX + unit.maxX * (bbox.maxX - bbox.minX),
			minY: bbox.minY + unit.minY * (bbox.maxY - bbox.minY),
			maxY: bbox.minY + unit.maxY * (bbox.maxY - bbox.minY),
		};
		if (g.maxX <= g.minX || g.maxY <= g.minY) continue;

		// Extrapolate the frame's geographic extent linearly out to the
		// rendered page rect. y-up user space: low y = south.
		const degPerUnitX = (geo.maxX - geo.minX) / (g.maxX - g.minX);
		const degPerUnitY = (geo.maxY - geo.minY) / (g.maxY - g.minY);
		const bounds: GeoBounds = {
			w: geo.minX + (crop.minX - g.minX) * degPerUnitX,
			e: geo.minX + (crop.maxX - g.minX) * degPerUnitX,
			s: geo.minY + (crop.minY - g.minY) * degPerUnitY,
			n: geo.minY + (crop.maxY - g.minY) * degPerUnitY,
		};
		if (
			bounds.e - bounds.w > MAX_EXTRAPOLATION_FACTOR * (geo.maxX - geo.minX) ||
			bounds.n - bounds.s > MAX_EXTRAPOLATION_FACTOR * (geo.maxY - geo.minY)
		)
			continue;
		if (!plausible(bounds)) continue;

		return { bounds, crop, frame: g, gcps };
	}
	return null;
}

/** Resolve the LPTS y-axis convention. The spec reads LPTS y bottom-up (page
 *  user space), but ArcGIS writes it TOP-DOWN (viewport convention) — the
 *  as-written pairing then encodes a vertical mirror that an affine fits
 *  PERFECTLY (zero residual, det < 0, map upside-down), so residuals alone
 *  can never catch it. Try the pairing as written, then y-flipped about the
 *  BBox; keep whichever yields a sane orientation (`flipped` reports which
 *  won, so the caller can mirror the LPTS extent to match). Both failing →
 *  null (caller falls back to the flat bounds mapping). */
function orientGcps(
	gcps: GeoRefPoint[],
	bbox: Rect,
): { gcps: GeoRefPoint[]; flipped: boolean } | null {
	if (gcpsTrustworthy(gcps)) return { gcps, flipped: false };
	const flipped = gcps.map((p) => ({
		...p,
		y: bbox.minY + bbox.maxY - p.y,
	}));
	if (gcpsTrustworthy(flipped)) return { gcps: flipped, flipped: true };
	return null;
}

/** Whether the point pairing yields a sane map orientation: no mirror, and
 *  page-up within 45° of north. The bearing prior is what disambiguates the
 *  two LPTS y conventions (the wrong one reads as an upside-down sheet) and
 *  rejects a wrong assumed GPTS order; the rare deliberately-rotated-past-45°
 *  sheet simply falls back to the flat mapping. */
function gcpsTrustworthy(gcps: GeoRefPoint[]): boolean {
	const t = fitPageToGeoAffine(gcps);
	if (!t) return false;
	// Orientation: page is y-up, geo is lat-north — a legitimate (non-mirrored)
	// registration always has positive determinant.
	if (t.a * t.e - t.b * t.d <= 0) return false;
	// Bearing of the page +y axis vs north (metre-corrected).
	const midLat = gcps.reduce((s, p) => s + p.lat, 0) / gcps.length;
	const bearing = Math.atan2(t.b * Math.cos((midLat * Math.PI) / 180), t.e);
	return Math.abs(bearing) <= Math.PI / 4;
}

/** Affine page→geo transform: lng = a·x + b·y + c, lat = d·x + e·y + f.
 *  Unlike the axis-aligned `bounds`, this carries the sheet's true rotation —
 *  the whole reason labels projected through `bounds` alone land hundreds of
 *  metres off on a rotated sheet while the raster (placed on the true quad)
 *  sits correctly. */
export interface PageToGeoAffine {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export function applyPageToGeo(
	t: PageToGeoAffine,
	x: number,
	y: number,
): [number, number] {
	return [t.a * x + t.b * y + t.c, t.d * x + t.e * y + t.f];
}

const METERS_PER_DEG = 110_540;

/** Least-squares affine fit through the ground-control points (≥3, mean-
 *  centred for conditioning). Returns null when the points are collinear,
 *  the fit is degenerate, or its worst reprojection error exceeds
 *  max(30 m, 1% of the sheet's diagonal) — a bad pairing must fall back to
 *  the axis-aligned bounds, never ship a garbage placement. */
export function fitPageToGeoAffine(
	gcps: GeoRefPoint[],
): PageToGeoAffine | null {
	if (gcps.length < 3) return null;
	const n = gcps.length;
	let mx = 0;
	let my = 0;
	let ml = 0;
	let mt = 0;
	for (const p of gcps) {
		mx += p.x;
		my += p.y;
		ml += p.lng;
		mt += p.lat;
	}
	mx /= n;
	my /= n;
	ml /= n;
	mt /= n;
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	let sxl = 0;
	let syl = 0;
	let sxt = 0;
	let syt = 0;
	for (const p of gcps) {
		const X = p.x - mx;
		const Y = p.y - my;
		const L = p.lng - ml;
		const T = p.lat - mt;
		sxx += X * X;
		sxy += X * Y;
		syy += Y * Y;
		sxl += X * L;
		syl += Y * L;
		sxt += X * T;
		syt += Y * T;
	}
	const det = sxx * syy - sxy * sxy;
	const scale = Math.max(sxx, syy);
	if (!Number.isFinite(det) || Math.abs(det) < 1e-9 * scale * scale)
		return null;
	const a = (sxl * syy - syl * sxy) / det;
	const b = (syl * sxx - sxl * sxy) / det;
	const d = (sxt * syy - syt * sxy) / det;
	const e = (syt * sxx - sxt * sxy) / det;
	const c = ml - a * mx - b * my;
	const f = mt - d * mx - e * my;
	const t: PageToGeoAffine = { a, b, c, d, e, f };
	if (![a, b, c, d, e, f].every(Number.isFinite)) return null;

	const mLat = METERS_PER_DEG;
	const mLng = METERS_PER_DEG * Math.cos((mt * Math.PI) / 180);
	let maxErr = 0;
	let minLng = Infinity;
	let maxLng = -Infinity;
	let minLat = Infinity;
	let maxLat = -Infinity;
	for (const p of gcps) {
		const [plng, plat] = applyPageToGeo(t, p.x, p.y);
		const err = Math.hypot((plng - p.lng) * mLng, (plat - p.lat) * mLat);
		if (err > maxErr) maxErr = err;
		if (p.lng < minLng) minLng = p.lng;
		if (p.lng > maxLng) maxLng = p.lng;
		if (p.lat < minLat) minLat = p.lat;
		if (p.lat > maxLat) maxLat = p.lat;
	}
	const diagM = Math.hypot((maxLng - minLng) * mLng, (maxLat - minLat) * mLat);
	if (maxErr > Math.max(30, diagM * 0.01)) return null;
	return t;
}

/** Extract overlay bounds from a GeoPDF's bytes on-device. Returns null for a
 *  non-georeferenced PDF, a rotated/exotic one we can't trust, or any parse
 *  failure — the caller treats null as "fall back to the server". Never throws. */
export async function extractGeoPdfBounds(
	bytes: Uint8Array,
): Promise<GeoBounds | null> {
	return (await extractGeoPdfLayout(bytes))?.bounds ?? null;
}

/** Does this PDF carry ANY georeferencing at all?
 *
 *  `extractGeoPdfLayout` returning null conflates two very different facts:
 *    • "parsed fine, but there's no georef in it"  → the user's file simply
 *      isn't a map. WE KNOW THIS NOW, on-device, for free.
 *    • "we couldn't read it / the georef is exotic" → the server might still
 *      manage it, so it's worth the round trip.
 *
 *  Only the FIRST is a settled verdict, and it's the one that deserves the
 *  friendly "this isn't a georeferenced map" message immediately — instead of
 *  a 30-second GDAL wait that comes back with the same answer dressed up as a
 *  server error. This function isolates it: true means "a georef dictionary
 *  exists in here somewhere", false means "definitively none".
 *
 *  Deliberately CRUDE and permissive — it looks for the presence of the georef
 *  keys, not their validity. A malformed/rotated/exotic georef returns true so
 *  the server still gets its chance; only a PDF with no georef whatsoever
 *  returns false. False positives cost a round trip (status quo); a false
 *  NEGATIVE would wrongly refuse a real map, so we bias hard that way.
 *
 *  Never throws — an unreadable PDF returns true ("don't refuse it here").
 */
export async function pdfHasAnyGeoref(bytes: Uint8Array): Promise<boolean> {
	try {
		const doc = await PDFDocument.load(bytes, {
			updateMetadata: false,
			throwOnInvalidObject: false,
		});
		for (const page of doc.getPages()) {
			const node = page.node;
			// OGC best-practice GeoPDF (Terrago/ArcMap): the page's /VP
			// viewport array → /Measure → /GPTS + /LPTS. `boundsFromPage`
			// above walks exactly this chain, so we probe the same keys —
			// plus /LGIDict, the older Adobe/TerraGo geospatial dictionary.
			if (node.lookup(PDFName.of("VP"))) return true;
			if (node.lookup(PDFName.of("Measure"))) return true;
			if (node.lookup(PDFName.of("LGIDict"))) return true;
		}
		return false;
	} catch {
		// Couldn't even parse it — not our call to make here. Let the normal
		// path (and the server) decide.
		return true;
	}
}

/** Like `extractGeoPdfBounds` but returns the full layout (bounds + crop +
 *  frame rects) — needed by the text-label extractor to project page-space
 *  text positions to lng/lat and to filter collar text off the map. Same
 *  never-throws contract. */
export async function extractGeoPdfLayout(
	bytes: Uint8Array,
): Promise<GeoPdfLayout | null> {
	try {
		const doc = await PDFDocument.load(bytes, {
			updateMetadata: false,
			throwOnInvalidObject: false,
		});
		for (const page of doc.getPages()) {
			const layout = boundsFromPage(page);
			if (layout) return layout;
		}
		return null;
	} catch {
		return null;
	}
}

/** True if the PDF draws any image with the /JPXDecode (JPEG 2000) filter.
 *
 *  WHY THIS EXISTS: ArcMap exports the rendered basemap (roads, polygons,
 *  imagery) as a stack of JPEG 2000 image strips. pdf.js's JPX decoder is
 *  incomplete — it logs "Dependent image isn't ready yet" and composites
 *  NOTHING for those strips, so the on-device instant render drops the entire
 *  map body and shows only the vector labels + legend (a washed-out,
 *  polygon-less map). On a fast connection the server WebP swaps in and hides
 *  the flaw; on one-bar field internet the swap never lands and the user is
 *  stuck on the broken render. So importPdf skips the instant render entirely
 *  when this returns true and goes straight to the (correct) server path.
 *  See importPdf.ts and the July-2026 field report. Never throws — any parse failure returns false so the caller keeps
 *  its existing instant-render attempt (which then self-guards via try/catch). */
export async function pdfUsesJpxImages(bytes: Uint8Array): Promise<boolean> {
	const isJpxFilter = (filter: unknown): boolean => {
		// /Filter is either a single name or an array of names (a filter chain).
		if (filter instanceof PDFName) return filter.asString() === "/JPXDecode";
		if (filter instanceof PDFArray) {
			for (let i = 0; i < filter.size(); i++) {
				const f = filter.get(i);
				if (f instanceof PDFName && f.asString() === "/JPXDecode") return true;
			}
		}
		return false;
	};
	try {
		const doc = await PDFDocument.load(bytes, {
			updateMetadata: false,
			throwOnInvalidObject: false,
		});
		// Walk every indirect object; any image stream carrying /JPXDecode is
		// enough. Enumerating the whole object map (rather than descending page
		// → Resources → XObject, which can nest through Form XObjects) is both
		// simpler and immune to how deeply the export buries its image tiles.
		const context = doc.context;
		for (const [, obj] of context.enumerateIndirectObjects()) {
			if (obj instanceof PDFRawStream) {
				if (isJpxFilter(obj.dict.get(PDFName.of("Filter")))) return true;
			} else if (obj instanceof PDFDict) {
				// A stream dict can also surface as a plain PDFDict in some
				// object layouts — check its /Filter too.
				if (isJpxFilter(obj.get(PDFName.of("Filter")))) return true;
			}
		}
		return false;
	} catch {
		return false;
	}
}
