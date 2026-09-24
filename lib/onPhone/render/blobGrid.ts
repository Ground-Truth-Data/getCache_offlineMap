/**
 * The ghost grid: one white square per pin, its `radiusBox`, so the grid can
 * never disagree with the generated data. Not the z8 tiles of `cellsFor`:
 * those are the blob's address and read as a huge regular tile grid.
 */

import { radiusBox } from "../../contract/grid";

export const BLOB_GRID_SOURCE = "v4-blob-grid";

/** The radius-box square per pin; identical boxes dedupe. */
export function blobGridFeatures(
	anchors: ReadonlyArray<readonly [number, number]>,
): GeoJSON.FeatureCollection {
	const seen = new Set<string>();
	const features: GeoJSON.Feature[] = [];
	for (const [lng, lat] of anchors) {
		const b = radiusBox(lng, lat);
		const key = `${b.w.toFixed(6)},${b.s.toFixed(6)},${b.e.toFixed(6)},${b.n.toFixed(6)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		features.push({
			type: "Feature",
			properties: { box: key },
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[b.w, b.s],
						[b.e, b.s],
						[b.e, b.n],
						[b.w, b.n],
						[b.w, b.s],
					],
				],
			},
		});
	}
	return { type: "FeatureCollection", features };
}
