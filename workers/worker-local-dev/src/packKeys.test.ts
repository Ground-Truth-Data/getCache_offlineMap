import { describe, expect, it, vi } from "vitest";

vi.mock("./mvtFilter", () => ({
	filterMvtToLayers: (b: ArrayBuffer) => b,
	allowlistOf: () => ({}),
}));
vi.mock("./oneBlob", () => ({
	buildBlobTile: () => ({ bytes: new Uint8Array([1, 2, 3, 4]), features: 1 }),
	boxFrame: () => ({ w: 0, s: 0, e: 1, n: 1 }),
}));

const requested: string[] = [];
const archive = {
	getHeader: async () => ({}),
	getZxy: async (z: number, x: number, y: number) => {
		requested.push(`${z}/${x}/${y}`);
		return { data: new Uint8Array([9, 9, 9, 9]).buffer };
	},
} as never;

function keysOf(pack: ArrayBuffer): string[] {
	const buf = new Uint8Array(pack);
	const len = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true);
	const manifest = JSON.parse(
		new TextDecoder().decode(buf.subarray(4, 4 + len)),
	) as { tiles: Array<{ k: string }> };
	return manifest.tiles.map((t) => t.k);
}

const LNG = -123.0694;
const LAT = 49.2606;

describe("buildPack keys every tile by the PIN", () => {
	it("pin/… or shallow/… keys only — a cell key is shared by neighbouring pins (the 50 km bug)", async () => {
		const { buildPack } = await import("./packBuilder");
		const keys = keysOf(await buildPack(archive, LNG, LAT));

		expect(keys.length).toBeGreaterThan(0);
		for (const k of keys) {
			expect(k).toMatch(/^(pin|shallow)\/-?[\d.]+,-?[\d.]+\/\d+\/\d+\/\d+$/);
		}
	});

	it("the shallow tier ships z6 keys under shallow/ — never in the pin/ namespace (pv46)", async () => {
		const { buildPack } = await import("./packBuilder");
		const keys = keysOf(await buildPack(archive, LNG, LAT));
		const shallow = keys.filter((k) => k.startsWith("shallow/"));
		expect(shallow.length).toBeGreaterThanOrEqual(1);
		for (const k of shallow) expect(k).toMatch(/^shallow\/-?[\d.]+,-?[\d.]+\/6\/\d+\/\d+$/);
		const pins = keys.filter((k) => k.startsWith("pin/"));
		for (const k of pins) expect(k).toMatch(/^pin\/-?[\d.]+,-?[\d.]+\/8\/\d+\/\d+$/);
	});

	it("two different pins never share a key", async () => {
		const { buildPack } = await import("./packBuilder");
		const a = new Set(keysOf(await buildPack(archive, LNG, LAT)));
		const b = keysOf(await buildPack(archive, LNG + 0.01, LAT));

		expect(b.length).toBeGreaterThan(0);
		for (const k of b) expect(a.has(k)).toBe(false);
	});

	it("direction2.4: the z6 is BUILT from the disc reads — the archive never serves a z6 tile", async () => {
		requested.length = 0;
		const { buildPack } = await import("./packBuilder");
		await buildPack(archive, LNG, LAT);

		expect(requested.length).toBeGreaterThan(0);
		for (const k of requested) expect(k.startsWith("13/")).toBe(true);
	});
});
