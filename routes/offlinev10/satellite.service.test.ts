// @vitest-environment happy-dom
// The photo service: it bakes every blob's photo at start and on coming back
// online, bakes a new blob's photo as its tiles start, tells the dock why
// photos stopped and when they came back, and drops a photo on request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	bake: vi.fn(async (): Promise<{ blob: Blob } | null> => ({ blob: new Blob(["x"]) })),
	drop: vi.fn(async () => {}),
	blob: null as null | ((e: { kind: string; id: string; photoKey?: string; photoCenter?: [number, number] }) => void),
	regions: [] as Array<{ id: string; photoKey?: string; photoCenter?: [number, number] }>,
	notPins: new Set<string>(),
}));
vi.mock("../../lib/onPhone/satellite/satelliteImage", () => ({
	CLOSE_UP: {},
	PHOTO_COVERAGE_RADIUS_KM: 2,
	bakeSatelliteImage: h.bake,
	deleteSatImage: h.drop,
	getSatImageByKey: async () => undefined,
	isCurrentPhoto: () => false,
	satImageMeta: async () => [],
}));
vi.mock("./blobService", () => ({
	onBlob: (fn: typeof h.blob) => ((h.blob = fn), () => void (h.blob = null)),
	photoIds: () => ({ has: (id: string) => !h.notPins.has(id) }),
}));
vi.mock("./store", () => ({
	AreaGone: class extends Error {},
	claimArea: async () => {},
	getPhotoTiles: async () => new Map(),
	notePhotoBytes: () => {},
	photoTileBytes: async () => new Map(),
	putPhotoTiles: async () => {},
	regionsSnapshot: () => ({ version: 1, regions: Promise.resolve(h.regions) }),
}));


// Every pass first asks the Worker which source is on.
const squirrel = (other: (url: string) => Promise<unknown> = async () => new Response(null, { status: 404 })) =>
	vi.fn(async (url: string) => (String(url).endsWith("/squirrel/active") ? new Response(JSON.stringify({ active: "maptiler" })) : other(url)));

import { configureTilesDevHost } from "../../lib/worker/tilesHost";
configureTilesDevHost("https://tiles.test");
import { dropPhoto, onPhoto, onPhotoIssue, photoIssue, startPhotoService } from "./satellite";

beforeEach(() => {
	h.bake.mockClear();
	vi.stubGlobal("fetch", squirrel());
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "info").mockImplementation(() => {});
	vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("startPhotoService", () => {
	it("bakes once the pins are known, on a blob's start and on coming online; one start owns shutdown", async () => {
		// "shape" was born with a photo under the old rule; it is no pin now, so it never bakes.
		h.notPins = new Set(["shape"]);
		h.regions = [{ id: "a", photoKey: "pa", photoCenter: [-119, 49] }, { id: "shape", photoKey: "ps", photoCenter: [-119, 48] }, { id: "follow" }];
		const landed = vi.fn();
		const offLanded = onPhoto(landed);
		const stop = startPhotoService();
		startPhotoService()();
		await new Promise((r) => setTimeout(r, 10));
		expect(h.bake).not.toHaveBeenCalled();
		h.blob!({ kind: "pins", id: "" });
		await vi.waitFor(() => expect(landed).toHaveBeenCalledTimes(1));
		expect(h.bake.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["pa"]);

		h.blob!({ kind: "start", id: "b", photoKey: "pb", photoCenter: [-118, 48] });
		h.blob!({ kind: "start", id: "c" });
		h.blob!({ kind: "done", id: "d", photoKey: "pd", photoCenter: [0, 1] });
		await vi.waitFor(() => expect(landed).toHaveBeenCalledTimes(2));
		expect(h.bake.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["pa", "pb"]);

		h.regions = [{ id: "e", photoKey: "pe", photoCenter: [-117, 47] }];
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() => expect(landed).toHaveBeenCalledTimes(3));
		offLanded();
		stop();
		expect(h.blob).toBeNull();
		h.bake.mockClear();
		window.dispatchEvent(new Event("online"));
		await new Promise((r) => setTimeout(r, 10));
		expect(h.bake).not.toHaveBeenCalled();
	});
});

describe("photo issue", () => {
	it("says why photos stopped, once, and clears when one lands after the pause", async () => {
		const heard = vi.fn();
		const off = onPhotoIssue(heard);
		h.bake.mockResolvedValueOnce(null);
		h.regions = [{ id: "f", photoKey: "pf", photoCenter: [-116, 46] }];
		vi.useFakeTimers({ toFake: ["Date"] });
		const stop = startPhotoService();
		h.blob!({ kind: "pins", id: "" });
		await vi.waitFor(() => expect(photoIssue()).toBe("no imagery came back"));
		expect(heard).toHaveBeenCalledTimes(1);
		vi.setSystemTime(Date.now() + 10 * 60_000);
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() => expect(photoIssue()).toBeNull());
		expect(heard).toHaveBeenCalledTimes(2);
		off();
		stop();
	});
});

describe("a rate-limited imagery host", () => {
	it("pauses the pass for exactly its Retry-After, then bakes again", async () => {
		const { RateLimited } = await import("./download");
		vi.useFakeTimers({ toFake: ["Date"] });
		// Past any pause the test above left.
		vi.setSystemTime(Date.now() + 60 * 60_000);
		h.bake.mockClear();
		h.bake.mockRejectedValueOnce(new RateLimited(30_000, "https://tiles.test/satellite/17/1/1.jpg"));
		h.regions = [{ id: "g", photoKey: "pg", photoCenter: [-115, 45] }];
		const stop = startPhotoService();
		h.blob!({ kind: "pins", id: "" });
		await vi.waitFor(() => expect(photoIssue()).toBe("imagery host busy, retrying in 30 s"));
		vi.setSystemTime(Date.now() + 29_000);
		window.dispatchEvent(new Event("online"));
		await new Promise((r) => setTimeout(r, 10));
		expect(h.bake).toHaveBeenCalledTimes(1);
		vi.setSystemTime(Date.now() + 2_000);
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() => expect(h.bake).toHaveBeenCalledTimes(2));
		stop();
	});
});

describe("dropPhoto", () => {
	it("deletes the stored photo by its key", async () => {
		await dropPhoto("pz");
		expect(h.drop).toHaveBeenCalledWith("pz");
	});
});
