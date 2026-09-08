import { describe, expect, it } from "vitest";
import { localitiesIn, placeLabel } from "./places";
import { ANCHOR_Z, latToY, lngToX } from "./tiles";

// ── a tiny MVT encoder: one `places` layer of points with string tags ───────
function varint(out: number[], v: number): void {
	let n = v;
	while (n > 0x7f) {
		out.push((n & 0x7f) | 0x80);
		n = Math.floor(n / 128);
	}
	out.push(n);
}
const zig = (v: number): number => (v << 1) ^ (v >> 31);
function bytes(out: number[], field: number, body: number[]): void {
	varint(out, (field << 3) | 2);
	varint(out, body.length);
	out.push(...body);
}
function str(field: number, s: string): number[] {
	const out: number[] = [];
	bytes(out, field, [...new TextEncoder().encode(s)]);
	return out;
}
interface P {
	x: number;
	y: number;
	tags: Record<string, string>;
}
function placesTile(points: P[], extent = 4096): Uint8Array {
	const keys = [...new Set(points.flatMap((p) => Object.keys(p.tags)))];
	const values = [...new Set(points.flatMap((p) => Object.values(p.tags)))];
	const layer: number[] = [...str(1, "places")];
	for (const p of points) {
		const body: number[] = [];
		const tags: number[] = [];
		for (const [k, v] of Object.entries(p.tags)) {
			varint(tags, keys.indexOf(k));
			varint(tags, values.indexOf(v));
		}
		bytes(body, 2, tags);
		varint(body, (3 << 3) | 0);
		varint(body, 1);
		const g: number[] = [];
		varint(g, (1 << 3) | 1);
		varint(g, zig(p.x));
		varint(g, zig(p.y));
		bytes(body, 4, g);
		bytes(layer, 2, body);
	}
	for (const k of keys) layer.push(...str(3, k));
	for (const v of values) bytes(layer, 4, str(1, v));
	varint(layer, (5 << 3) | 0);
	varint(layer, extent);
	varint(layer, (15 << 3) | 0);
	varint(layer, 2);
	const out: number[] = [];
	bytes(out, 3, layer);
	return Uint8Array.from(out);
}

const OLIVER = { lng: -119.55, lat: 49.18 };
const X = lngToX(OLIVER.lng, ANCHOR_Z);
const Y = latToY(OLIVER.lat, ANCHOR_Z);

describe("localitiesIn", () => {
	it("reads every locality with its name and puts it back on the earth", () => {
		const tile = placesTile([
			{ x: 100, y: 200, tags: { kind: "locality", name: "Oliver" } },
			{ x: 3000, y: 4000, tags: { kind: "locality", name: "Kaleden" } },
		]);
		const out = localitiesIn(tile, ANCHOR_Z, X, Y);
		expect(out.map((p) => p.name)).toEqual(["Oliver", "Kaleden"]);
		// the point at 100/4096 across the tile is inside the tile's own box
		expect(lngToX(out[0].lng, ANCHOR_Z)).toBe(X);
		expect(latToY(out[0].lat, ANCHOR_Z)).toBe(Y);
		// and further east/south than the first
		expect(out[1].lng).toBeGreaterThan(out[0].lng);
		expect(out[1].lat).toBeLessThan(out[0].lat);
	});

	it("skips regions, counties and nameless points — a blob is named after a town, not a province", () => {
		const tile = placesTile([
			{ x: 10, y: 10, tags: { kind: "region", name: "British Columbia" } },
			{ x: 20, y: 20, tags: { kind: "county", name: "Okanagan-Similkameen" } },
			{ x: 30, y: 30, tags: { kind: "locality", name: "" } },
			{ x: 40, y: 40, tags: { kind: "locality", name: "Osoyoos" } },
		]);
		expect(localitiesIn(tile, ANCHOR_Z, X, Y).map((p) => p.name)).toEqual([
			"Osoyoos",
		]);
	});

	it("a tile with no places layer names nothing", () => {
		expect(localitiesIn(new Uint8Array(0), ANCHOR_Z, X, Y)).toEqual([]);
	});
});

describe("placeLabel", () => {
	it("the town alone when the pin is in it, with the distance when it is not", () => {
		expect(placeLabel({ name: "Oliver", km: 0.4 })).toBe("Oliver");
		expect(placeLabel({ name: "Oliver", km: 12.4 })).toBe("Oliver · 12 km");
	});
});
