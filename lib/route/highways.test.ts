import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ wifi: true, host: "https://tiles.test" as string | null, wifiAsked: 0 }));
vi.mock("../worker/tilesHost", () => ({
	onWifi: async () => (net.wifiAsked++, net.wifi),
	tilesHost: () => net.host,
}));
// The archive reader is pmtiles' own; here a tile at zoom 5 is "a highway crosses it", any other zoom is empty.
const opened = vi.hoisted(() => [] as string[]);
vi.mock("pmtiles", () => ({
	FileSource: class {
		constructor(public file: File) {}
	},
	PMTiles: class {
		constructor(src: { file: File }) {
			opened.push(src.file.name);
		}
		async getZxy(z: number) {
			return z === 5 ? { data: new Uint8Array([1, 2, 3]).buffer } : undefined;
		}
	},
}));

const fetched: string[] = [];
let answer = () => new Response(new Blob([new Uint8Array([9])]));

async function freshPage() {
	vi.resetModules();
	return (await import("./highways")).highwayTile;
}

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
	vi.useFakeTimers({ toFake: ["setTimeout"] });
	net.wifi = true;
	net.host = "https://tiles.test";
	net.wifiAsked = 0;
	opened.length = 0;
	fetched.length = 0;
	answer = () => new Response(new Blob([new Uint8Array([9])]));
	vi.stubGlobal("fetch", async (url: string) => (fetched.push(url), answer()));
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("the world's highways, fetched once on Wi-Fi and kept on the phone", () => {
	it("comes down once, serves its tiles, and a highway-free tile is empty", async () => {
		const highwayTile = await freshPage();
		expect(new Uint8Array((await highwayTile(5, 1, 1))!)).toEqual(new Uint8Array([1, 2, 3]));
		expect(await highwayTile(6, 1, 1)).toBeUndefined();
		expect(fetched).toEqual(["https://tiles.test/highways-v2.pmtiles"]);
		expect(opened).toEqual(["highways-v2.pmtiles"]);
	});

	it("a later page opens the kept copy without the network, even off Wi-Fi", async () => {
		await (await freshPage())(5, 1, 1);
		net.wifi = false;
		expect(await (await freshPage())(5, 1, 1)).toBeDefined();
		expect(fetched).toHaveLength(1);
	});

	it("a kept copy of an older build's file is replaced", async () => {
		const req = indexedDB.open("gc-highways", 1);
		req.onupgradeneeded = () => req.result.createObjectStore("file");
		await new Promise((ok) => (req.onsuccess = ok));
		const put = req.result.transaction("file", "readwrite").objectStore("file").put({ name: "highways-v1.pmtiles", blob: new Blob([]) }, "highways");
		await new Promise((ok) => (put.onsuccess = ok));
		req.result.close();
		await (await freshPage())(5, 1, 1);
		expect(fetched).toEqual(["https://tiles.test/highways-v2.pmtiles"]);
	});
});

describe("no file yet: no tile, and a minute's wait before the next try", () => {
	it("off Wi-Fi it asks once per minute, never over the crew's data plan", async () => {
		const highwayTile = await freshPage();
		net.wifi = false;
		expect(await highwayTile(5, 1, 1)).toBeUndefined();
		expect(await highwayTile(5, 2, 2)).toBeUndefined();
		expect(net.wifiAsked).toBe(1);
		expect(fetched).toEqual([]);
		net.wifi = true;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await highwayTile(5, 1, 1)).toBeDefined();
		expect(fetched).toHaveLength(1);
	});

	it("a refused download is logged, not thrown, and nothing is kept", async () => {
		answer = () => new Response("gone", { status: 404 });
		const highwayTile = await freshPage();
		expect(await highwayTile(5, 1, 1)).toBeUndefined();
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[highways] would not load"), expect.objectContaining({ message: "https://tiles.test/highways-v2.pmtiles → 404" }));
		answer = () => new Response(new Blob([new Uint8Array([9])]));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await highwayTile(5, 1, 1)).toBeDefined();
	});

	it("with no tiles host it says so", async () => {
		net.host = null;
		expect(await (await freshPage())(5, 1, 1)).toBeUndefined();
		expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: "no tiles host" }));
	});
});
