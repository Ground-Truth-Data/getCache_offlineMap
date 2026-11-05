/** A piece is held whole or not at all: its cover at the source's own zoom, asked of the tile source once, a tile the
 * source lacks filled from Sentinel, and nothing asked once the session byte cap trips. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = new Map<string, unknown>();
vi.mock("../store/keyedIdbStore", () => ({
	makeKeyedIdbStore: () => ({
		get: async (k: string) => saved.get(k),
		put: async (k: string, v: unknown) => void saved.set(k, v),
		keys: async () => [...saved.keys()],
		delete: async (k: string) => void saved.delete(k),
		getAll: async () => [...saved.values()],
		getAllProjected: async () => [],
	}),
}));

type Pt = [number, number];
/** A square about 800 m a side in Nice, France: MapTiler at z16. */
const square = ([x, y]: Pt, d = 0.01): Pt[] => [[x, y], [x + d, y], [x + d, y + d * 0.72], [x, y + d * 0.72], [x, y]];
const PIN: Pt = [7.2, 43.68];
const RING = square(PIN);
const KEY = "piece:nice";
/** Measured at this ring; past this the cover has grown. */
const MAX_TILES_PER_AREA = 24;

beforeEach(() => {
	vi.resetModules();
	saved.clear();
});

async function save(answer: (keys: string[], source: string | undefined) => Map<string, ArrayBuffer>) {
	const { saveAreaTiles } = await import("./satelliteImage");
	const { SATELLITE_SOURCES } = await import("../../contract/satelliteSources");
	const asked: { keys: string[]; source: string | undefined }[] = [];
	const img = await saveAreaTiles(KEY, [RING], SATELLITE_SOURCES.maptiler, async (keys, source) => {
		asked.push({ keys, source });
		return answer(keys, source);
	});
	return { img, asked };
}

const all = (keys: string[]) => new Map(keys.map((k) => [k, new ArrayBuffer(8)]));

describe("a piece is whole or not saved", () => {
	it("every tile arrived: one ask, the cover at z16 and no coarser tile, and the record is saved", async () => {
		const { img, asked } = await save(all);
		expect(img).toMatchObject({ source: "MapTiler", zoom: 16 });
		expect(saved.has(KEY)).toBe(true);
		expect(asked).toHaveLength(1);
		const zooms = new Set(asked[0]!.keys.map((k) => Number(k.split("/")[0])));
		expect([...zooms]).toEqual([16]);
		expect(asked[0]!.keys.length).toBeLessThanOrEqual(MAX_TILES_PER_AREA);
	});

	it("the same spot again asks for nothing", async () => {
		await save(all);
		const { asked } = await save(all);
		expect(asked).toHaveLength(0);
	});

	it("one tile failed: no record, so the next pass asks again", async () => {
		const { img } = await save((keys) => {
			const got = all(keys);
			got.delete(keys[Math.floor(keys.length / 2)]!);
			return got;
		});
		expect(img).toBeNull();
		expect(saved.has(KEY)).toBe(false);
	});

	it("a z16 tile the source has no imagery for is filled from Sentinel's z14", async () => {
		const { img, asked } = await save((keys, source) => {
			const got = all(keys);
			if (!source) got.set(keys.at(-1)!, new ArrayBuffer(0));
			return got;
		});
		expect(asked.map((a) => a.source)).toEqual([undefined, "sentinel"]);
		expect(asked[1]!.keys).toHaveLength(1);
		expect(asked[1]!.keys[0]).toMatch(/^14\//);
		expect(img).not.toBeNull();
	});

	it("Sentinel fails too: no record", async () => {
		const { img } = await save((keys, source) => {
			const got = all(keys);
			if (!source) got.set(keys.at(-1)!, new ArrayBuffer(0));
			else got.clear();
			return got;
		});
		expect(img).toBeNull();
		expect(saved.has(KEY)).toBe(false);
	});

	it("a record from before tiles is not current, so the area is saved again over it", async () => {
		saved.set(KEY, { blob: new Blob(["old photo"]), bounds: [0, 0, 1, 1], bakeVersion: 11, source: "MapTiler", zoom: 16 });
		const { img, asked } = await save(all);
		expect(asked).toHaveLength(1);
		expect(saved.get(KEY)).toBe(img);
		expect(saved.get(KEY)).not.toHaveProperty("blob");
	});

	it("once the session byte cap trips, no tile is asked for at all", async () => {
		const { spendBytes, SESSION_BYTE_CAP } = await import("../../shared/sessionByteCap.svelte");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		spendBytes(SESSION_BYTE_CAP + 1);
		const { img, asked } = await save(all);
		expect(img).toBeNull();
		expect(asked).toHaveLength(0);
	});
});

describe("the held edge", () => {
	it("rings two overlapping pieces once, with no line inside either", async () => {
		const { heldEdge, coverTiles } = await import("./satelliteImage");
		const a = RING;
		const b = square([PIN[0] + 0.006, PIN[1] + 0.002]);
		const segs = heldEdge([{ ring: a, z: 16 }, { ring: b, z: 16 }]);
		const inner = (r: Pt[], [x, y]: Pt) => coverTiles(r, 16).some((t) => x > t.w && x < t.e && y > t.s && y < t.n);
		const mid = ([p, q]: Pt[]): Pt => [(p![0] + q![0]) / 2, (p![1] + q![1]) / 2];
		expect(segs.length).toBeGreaterThan(8);
		const d = 1e-6;
		expect(segs.filter(([p, q]) => {
			const [mx, my] = mid([p!, q!]);
			const off: Pt[] = p![0] === q![0] ? [[mx - d, my], [mx + d, my]] : [[mx, my - d], [mx, my + d]];
			return off.every((o) => inner(a, o) || inner(b, o));
		})).toEqual([]);
	});

	it("runs only where held ground meets nothing, across zooms", async () => {
		const { heldEdge, coverTiles } = await import("./satelliteImage");
		const areas = [{ ring: RING, z: 16 }, { ring: square([PIN[0] + 0.025, PIN[1] - 0.01], 0.02), z: 14 }];
		const covered = ([lng, lat]: [number, number]) =>
			areas.some(({ ring, z }) => coverTiles(ring, z).some((t) => lng > t.w && lng < t.e && lat > t.s && lat < t.n));
		const segs = heldEdge(areas);
		expect(segs.length).toBeGreaterThan(8);
		const d = 1e-6;
		const wrong = segs.filter(([[x0, y0], [x1, y1]]) => {
			const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
			const sides: [[number, number], [number, number]] = x0 === x1 ? [[mx - d, my], [mx + d, my]] : [[mx, my - d], [mx, my + d]];
			return covered(sides[0]) === covered(sides[1]);
		});
		expect(wrong).toEqual([]);
	});
});
