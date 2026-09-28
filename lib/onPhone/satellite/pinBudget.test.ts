/**
 * One pin's photo costs one fetch per tile, once. The bake used to race a 30 s
 * wall clock against a cold-cache disc (~300 tiles, ~30 s), and on a timeout
 * refetched every tile on the main thread while the worker finished — a pin cost
 * up to twice the bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("../store/keyedIdbStore", () => ({
	makeKeyedIdbStore: () => ({
		get: async (k: string) => store.get(k),
		keys: async () => [...store.keys()],
		put: async (k: string, v: unknown) => void store.set(k, v),
		delete: async (k: string) => void store.delete(k),
		getAll: async () => [...store.values()],
		getAllProjected: async () => [],
	}),
}));

const { configureTilesDevHost } = await import("../../worker/worker-local-dev/tilesHost");
const { bakeSatelliteImage } = await import("./satelliteImage");
configureTilesDevHost("https://tiles.test");

/** Nice, France: MapTiler z17 is the sharpest row, ~300 tiles across 2 km. */
const PIN: [number, number] = [7.2, 43.68];
/** Measured 298 at this pin; a bake past this has grown its disc. */
const MAX_TILES_PER_PIN = 330;
/** Slower than the old wall clock, so the old code refetched. */
const WORKER_MS = 45_000;

const posted: { tiles: unknown[] }[] = [];
const fetchMock = vi.fn();

class FakeWorker {
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	postMessage(req: { id: number; tiles: unknown[] }): void {
		posted.push(req);
		setTimeout(
			() =>
				this.onmessage?.({
					data: { id: req.id, blob: new Blob(["x"]), loaded: req.tiles.length, fetched: req.tiles.length, bytes: 1 },
				}),
			WORKER_MS,
		);
	}
	terminate(): void {}
}

beforeEach(() => {
	store.clear();
	posted.length = 0;
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(["t"]) });
	vi.useFakeTimers();
	vi.stubGlobal("Worker", FakeWorker);
	vi.stubGlobal("OffscreenCanvas", class { convertToBlob(): void {} });
	vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("document", {
		createElement: () => ({
			getContext: () => ({ drawImage() {} }),
			toBlob: (cb: (b: Blob) => void) => cb(new Blob(["x"])),
		}),
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function bake(): Promise<Awaited<ReturnType<typeof bakeSatelliteImage>>> {
	const p = bakeSatelliteImage(PIN);
	await vi.advanceTimersByTimeAsync(WORKER_MS + 1000);
	return p;
}

describe("what one pin's photo costs", () => {
	it("a slow bake fetches nothing on the main thread — the worker's fetches are the only ones", async () => {
		expect(await bake()).not.toBeNull();
		expect(posted).toHaveLength(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("the disc stays inside the tile ceiling", async () => {
		await bake();
		expect(posted[0].tiles.length).toBeGreaterThan(100);
		expect(posted[0].tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_PIN);
	});

	it("the same spot again costs nothing", async () => {
		await bake();
		posted.length = 0;
		await bakeSatelliteImage(PIN);
		expect(posted).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
