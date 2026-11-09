import { describe, expect, it, vi } from "vitest";
import { localitiesIn, nearestPlace, placeLabel } from "./places";
import { ANCHOR_Z, latToY, lngToX, xToLng, yToLat } from "./tiles";

const disk = new Map<string, ArrayBuffer>();
vi.mock("./store", () => ({ getTile: async (k: string) => disk.get(k) }));

// A tiny MVT encoder: one `places` layer of points with string tags.
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
		expect(lngToX(out[0].lng, ANCHOR_Z)).toBe(X);
		expect(latToY(out[0].lat, ANCHOR_Z)).toBe(Y);
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

describe("readable names", () => {
	it("a local name in Latin letters wins; otherwise English, then the Latin spelling, then the local name", () => {
		const tile = placesTile([
			{ x: 1, y: 1, tags: { kind: "locality", name: "Trois-Rivières", "name:en": "Three Rivers" } },
			{ x: 2, y: 2, tags: { kind: "locality", name: "ጎንደር", "name:en": "Gondar", "name:latin": "Gonder" } },
			{ x: 3, y: 3, tags: { kind: "locality", name: "መቀሌ", "name:latin": "Mekele" } },
			{ x: 4, y: 4, tags: { kind: "locality", name: "ባህር ዳር" } },
		]);
		expect(localitiesIn(tile, ANCHOR_Z, X, Y).map((p) => p.name)).toEqual(["Trois-Rivières", "Gondar", "Mekele", "ባህር ዳር"]);
	});
});

describe("nearestPlace", () => {
	const put = (x: number, y: number, points: P[]) => disk.set(`${ANCHOR_Z}/${x}/${y}`, placesTile(points).slice().buffer);
	const range = { x0: X, x1: X + 1, y0: Y, y1: Y + 1 };

	it("the nearest town across every tile of the range, its last row and column included", () => {
		disk.clear();
		put(X, Y, [{ x: 4000, y: 4000, tags: { kind: "locality", name: "Far" } }]);
		disk.set(`${ANCHOR_Z}/${X + 1}/${Y}`, new ArrayBuffer(0));
		put(X + 1, Y + 1, [
			{ x: 0, y: 0, tags: { kind: "locality", name: "Near" } },
			{ x: 2000, y: 2000, tags: { kind: "locality", name: "Middle" } },
		]);
		return expect(nearestPlace(range, xToLng(X + 1, ANCHOR_Z), yToLat(Y + 1, ANCHOR_Z))).resolves.toEqual({ name: "Near", km: 0 });
	});

	it("measures great-circle km: one z10 tile east at Oliver's latitude is about 25 km", async () => {
		disk.clear();
		put(X + 1, Y, [{ x: 0, y: 0, tags: { kind: "locality", name: "Oliver" } }]);
		const lat = yToLat(Y, ANCHOR_Z);
		const p = await nearestPlace(range, xToLng(X, ANCHOR_Z), lat);
		const expected = (360 / 2 ** ANCHOR_Z) * ((Math.PI * 6371) / 180) * Math.cos((lat * Math.PI) / 180);
		expect(p?.km).toBeCloseTo(expected, 1);
		expect(placeLabel(p!)).toBe("25 km from Oliver");
	});

	it("null when the range holds no town, or no tiles at all", async () => {
		disk.clear();
		await expect(nearestPlace(range, OLIVER.lng, OLIVER.lat)).resolves.toBeNull();
		put(X, Y, [{ x: 1, y: 1, tags: { kind: "region", name: "BC" } }]);
		await expect(nearestPlace(range, OLIVER.lng, OLIVER.lat)).resolves.toBeNull();
	});
});

describe("placeLabel", () => {
	it("the town alone when the pin is in it, with the distance when it is not", () => {
		expect(placeLabel({ name: "Oliver", km: 1.49 })).toBe("Oliver");
		expect(placeLabel({ name: "Oliver", km: 1.5 })).toBe("2 km from Oliver");
		expect(placeLabel({ name: "Oliver", km: 0.4 })).toBe("Oliver");
		expect(placeLabel({ name: "Oliver", km: 12.4 })).toBe("12 km from Oliver");
	});
});
