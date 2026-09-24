/**
 * Google's encoded-polyline format. Asked for over GeoJSON because it is a third of the bytes,
 * and the route is fetched at the edge of coverage.
 */

/** [lng, lat] pairs; `precision` is 5 for `polyline`, 6 for `polyline6`. */
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
