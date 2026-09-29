/**
 * The satellite byte cap holds whatever is driving the fetching: here a worker stuck in a
 * loop that reports one tile forever. The cap has to stop the loop itself, not just the count.
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

/** Nice, France: MapTiler z17, ~300 tiles across 2 km. */
const PIN: [number, number] = [7.2, 43.68];
const TILE_BYTES = 200_000;

let workers: FakeWorker[] = [];
let ticks = 0;
const fetchMock = vi.fn();

class FakeWorker {
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	terminated = false;
	timer: ReturnType<typeof setInterval> | undefined;
	constructor() {
		workers.push(this);
	}
	/** The loop: one tile reported per millisecond, forever. */
	postMessage(): void {
		this.timer = setInterval(() => {
			ticks += 1;
			this.onmessage?.({ data: { spent: TILE_BYTES } });
		}, 1);
	}
	terminate(): void {
		this.terminated = true;
		clearInterval(this.timer);
	}
}

/** A worker that keeps running and posting after terminate(). */
class DeafWorker extends FakeWorker {
	terminate(): void {
		this.terminated = true;
	}
}

/** One honest bake: every tile reported, then the result. */
class HonestWorker extends FakeWorker {
	postMessage(req: { id: number; tiles: unknown[] }): void {
		for (let i = 0; i < req.tiles.length; i++) this.onmessage?.({ data: { spent: TILE_BYTES } });
		this.onmessage?.({
			data: { id: req.id, blob: new Blob(["x"]), loaded: req.tiles.length, fetched: req.tiles.length, bytes: req.tiles.length * TILE_BYTES },
		});
	}
}

async function fresh(worker: typeof FakeWorker) {
	vi.resetModules();
	vi.stubGlobal("Worker", worker);
	const { configureTilesDevHost } = await import("../../worker/worker-local-dev/tilesHost");
	configureTilesDevHost("https://tiles.test");
	return { ...(await import("./satelliteImage")), ...(await import("../../shared/sessionByteCap.svelte")) };
}

beforeEach(() => {
	store.clear();
	workers = [];
	ticks = 0;
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(["t"]) });
	vi.useFakeTimers();
	vi.spyOn(console, "error").mockImplementation(() => undefined);
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
	vi.restoreAllMocks();
});

describe("the session byte cap", () => {
	it("kills a worker stuck in a runaway loop, and the loop with it", async () => {
		const { bakeSatelliteImage, sessionCap, SESSION_BYTE_CAP } = await fresh(FakeWorker);
		const baked = bakeSatelliteImage(PIN);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(await baked).toBeNull();
		expect(workers[0].terminated).toBe(true);
		expect(sessionCap.tripped).toBe(true);
		expect(sessionCap.spent).toBeLessThanOrEqual(SESSION_BYTE_CAP + TILE_BYTES);
		expect(ticks * TILE_BYTES).toBeLessThanOrEqual(SESSION_BYTE_CAP + TILE_BYTES);
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[session-byte-cap]"));
	});

	it("counts nothing more from a worker that ignores terminate()", async () => {
		const { bakeSatelliteImage, sessionCap } = await fresh(DeafWorker);
		const baked = bakeSatelliteImage(PIN);
		await vi.advanceTimersByTimeAsync(10_000);
		await baked;
		const spent = sessionCap.spent;
		const ticksAtTrip = ticks;

		await vi.advanceTimersByTimeAsync(10_000);
		expect(ticks).toBeGreaterThan(ticksAtTrip);
		expect(sessionCap.spent).toBe(spent);
	});

	it("starts no new worker and fetches nothing on the main thread once tripped", async () => {
		const { bakeSatelliteImage, sessionCap } = await fresh(FakeWorker);
		const first = bakeSatelliteImage(PIN);
		await vi.advanceTimersByTimeAsync(60_000);
		await first;
		expect(sessionCap.tripped).toBe(true);

		const again = bakeSatelliteImage([7.3, 43.7]);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(await again).toBeNull();
		expect(workers).toHaveLength(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("leaves an honest bake alone", async () => {
		const { bakeSatelliteImage, sessionCap, SESSION_BYTE_CAP } = await fresh(HonestWorker);
		const baked = bakeSatelliteImage(PIN);
		await vi.advanceTimersByTimeAsync(5_000);

		expect(await baked).not.toBeNull();
		expect(sessionCap.tripped).toBe(false);
		expect(sessionCap.spent).toBeGreaterThan(0);
		expect(sessionCap.spent).toBeLessThan(SESSION_BYTE_CAP);
	});
});
