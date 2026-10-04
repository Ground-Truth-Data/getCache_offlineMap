/** One pin's photo asks its tile source once, for one disc, and fetches nothing itself. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("../store/keyedIdbStore", () => ({
	makeKeyedIdbStore: () => ({
		get: async (k: string) => store.get(k),
		keys: async () => [...store.keys()],
		put: async (k: string, v: unknown) => void store.set(k, v),
		delete: async (k: string) => void store.delete(k),
		getAll: async () => [...store.values()],
		getAllProjected: async (project: (v: unknown) => unknown) => [...store.values()].map(project),
	}),
}));

const { bakeSatelliteImage } = await import("./satelliteImage");

/** Nice, France: MapTiler z17 is the sharpest row, ~300 tiles across 2 km. */
const PIN: [number, number] = [7.2, 43.68];
const KEY = "7.2000,43.6800";
/** Measured 298 at this pin; a bake past this has grown its disc. */
const MAX_TILES_PER_PIN = 330;

const asked: string[][] = [];
const source = async (keys: string[]) => {
	asked.push(keys);
	return new Map(keys.map((k) => [k, new ArrayBuffer(8)]));
};
const fetchMock = vi.fn();

class FakeWorker {
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	postMessage(req: { id: number; tiles: unknown[] }): void {
		queueMicrotask(() => this.onmessage?.({ data: { id: req.id, blob: new Blob(["x"]), loaded: req.tiles.length } }));
	}
	terminate(): void {}
}

beforeEach(() => {
	store.clear();
	asked.length = 0;
	fetchMock.mockReset();
	vi.stubGlobal("Worker", FakeWorker);
	vi.stubGlobal("OffscreenCanvas", class { convertToBlob(): void {} });
	vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("what one pin's photo costs", () => {
	it("one ask of the tile source, and not one fetch of its own", async () => {
		expect(await bakeSatelliteImage(KEY, PIN, source)).not.toBeNull();
		expect(asked).toHaveLength(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("the disc stays inside the tile ceiling", async () => {
		await bakeSatelliteImage(KEY, PIN, source);
		expect(asked[0].length).toBeGreaterThan(100);
		expect(asked[0].length).toBeLessThanOrEqual(MAX_TILES_PER_PIN);
	});

	it("the same spot again costs nothing", async () => {
		await bakeSatelliteImage(KEY, PIN, source);
		asked.length = 0;
		await bakeSatelliteImage(KEY, PIN, source);
		expect(asked).toHaveLength(0);
	});

	it("a disc the source can mostly not supply is no photo, so the pass retries", async () => {
		const thin = async (keys: string[]) => new Map(keys.slice(0, 10).map((k) => [k, new ArrayBuffer(8)]));
		expect(await bakeSatelliteImage(KEY, PIN, thin)).toBeNull();
	});
});
