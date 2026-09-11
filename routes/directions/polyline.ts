/**
 * Google's encoded-polyline format, which Mapbox Directions also returns.
 *
 * Decoding it here rather than asking for GeoJSON is deliberate: `geometries=polyline6`
 * is roughly a third of the bytes of the same line as coordinates, and this is
 * fetched on the edge of coverage where the request either completes in one
 * shot or not at all.
 */

/** Decode an encoded polyline into [lng, lat] pairs. `precision` is 5 for `polyline`, 6 for `polyline6`. */
export function decodePolyline(
	encoded: string,
	precision = 6,
): Array<[number, number]> {
	const factor = 10 ** precision;
	const out: Array<[number, number]> = [];
	let index = 0;
	let lat = 0;
	let lng = 0;

	while (index < encoded.length) {
		let result = 0;
		let shift = 0;
		let byte: number;
		do {
			byte = encoded.charCodeAt(index++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);
		lat += result & 1 ? ~(result >> 1) : result >> 1;

		result = 0;
		shift = 0;
		do {
			byte = encoded.charCodeAt(index++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);
		lng += result & 1 ? ~(result >> 1) : result >> 1;

		out.push([lng / factor, lat / factor]);
	}
	return out;
}
