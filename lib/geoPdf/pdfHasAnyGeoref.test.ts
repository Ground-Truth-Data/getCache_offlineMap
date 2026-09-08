// "Is this PDF even a map?" — answered ON-DEVICE, instantly.
//
// The failure this locks: importing a plain (non-georeferenced) PDF made the
// phone burn a ~30s GDAL round trip and then show a RED "Conversion failed —
// Unexpected error: RuntimeError('quad mode requested but source has no usable
// georef…')". Nothing had broken. The user imported a PDF that isn't a map,
// which they're entitled to do, and the phone already knew that before it ever
// called the server.
//
// pdfHasAnyGeoref is the settled-verdict probe. It is deliberately PERMISSIVE:
// a false positive costs one round trip (the old status quo), but a false
// NEGATIVE would wrongly refuse a real map — so anything with even a malformed
// georef must return true.

import {
	PDFArray,
	type PDFDict,
	PDFDocument,
	PDFName,
	PDFNumber,
} from "pdf-lib";
import { describe, expect, it } from "vitest";

import { pdfHasAnyGeoref } from "./geoPdfBounds.js";

/** A plain PDF with one blank page and no geospatial dictionary at all. */
async function makePlainPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.addPage([612, 792]);
	return await doc.save();
}

/** A PDF carrying the OGC /VP → /Measure → /GPTS chain a real GeoPDF has. */
async function makeGeoPdf(opts: { valid?: boolean } = {}): Promise<Uint8Array> {
	const { valid = true } = opts;
	const doc = await PDFDocument.create();
	const page = doc.addPage([612, 792]);
	const ctx = doc.context;
	const gpts = valid
		? [49, -123, 49, -122, 50, -122, 50, -123]
		: // Garbage coordinates — still a georef dictionary, so the probe must say true.
			// say "true" and let the server have its go at it.
			[0, 0, 0, 0, 0, 0, 0, 0];
	const measure = ctx.obj({
		Type: PDFName.of("Measure"),
		Subtype: PDFName.of("GEO"),
		GPTS: PDFArray.withContext(ctx),
		LPTS: PDFArray.withContext(ctx),
	}) as PDFDict;
	const gptsArr = measure.lookup(PDFName.of("GPTS")) as PDFArray;
	for (const n of gpts) gptsArr.push(PDFNumber.of(n));
	const lptsArr = measure.lookup(PDFName.of("LPTS")) as PDFArray;
	for (const n of [0, 0, 0, 1, 1, 1, 1, 0]) lptsArr.push(PDFNumber.of(n));
	const bbox = PDFArray.withContext(ctx);
	for (const n of [0, 0, 612, 792]) bbox.push(PDFNumber.of(n));
	const viewport = ctx.obj({ Type: PDFName.of("Viewport") }) as PDFDict;
	viewport.set(PDFName.of("BBox"), bbox);
	viewport.set(PDFName.of("Measure"), measure);
	const vp = PDFArray.withContext(ctx);
	vp.push(viewport);
	page.node.set(PDFName.of("VP"), vp);
	return await doc.save();
}

describe("pdfHasAnyGeoref", () => {
	it("says FALSE for a plain PDF — no georef anywhere", async () => {
		expect(await pdfHasAnyGeoref(await makePlainPdf())).toBe(false);
	});

	it("says TRUE for a real GeoPDF (/VP → /Measure → /GPTS)", async () => {
		expect(await pdfHasAnyGeoref(await makeGeoPdf())).toBe(true);
	});

	// The bias that keeps a real map from being wrongly refused on-device.
	it("says TRUE for a MALFORMED georef — the server still gets its chance", async () => {
		expect(await pdfHasAnyGeoref(await makeGeoPdf({ valid: false }))).toBe(
			true,
		);
	});

	it("says TRUE for unreadable bytes — never refuse what we couldn't parse", async () => {
		expect(await pdfHasAnyGeoref(new Uint8Array([1, 2, 3, 4]))).toBe(true);
		expect(await pdfHasAnyGeoref(new Uint8Array(0))).toBe(true);
	});
});
