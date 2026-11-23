// Naming reads only cells on the phone; a cell is fetched once and kept, an empty one too, a failed one not at all,
// and the native app (localhost, no port) fetches from the web host.
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { NEARBY_DB } from "../onPhone/store/dbCatalog";
import { currentDbName } from "../shared/sandboxDbNames";

vi.stubGlobal("indexedDB", new IDBFactory());
// A phone from before 2.5° cells: its 5° "20_26" (Ontario) is a 2.5° corner key in Libya now.
await new Promise<void>((done) => {
	const open = indexedDB.open(currentDbName(NEARBY_DB), 1);
	open.onupgradeneeded = () => open.result.createObjectStore("cells").put([["Mississippi Lake", -76.2, 45.05, 1]], "20_26");
	open.onsuccess = () => (open.result.close(), done());
});
const { cellsAround, fetchNearby, heldNearby } = await import("./nearbyCells");

const OBERON = ["Oberon Bay", 146.337, -39.066, 1] as const;

describe("nearby cells", () => {
	it("never reads a 5° cell an older build kept", async () => {
		expect(await heldNearby(["20_26"])).toEqual([]);
	});

	it("reads nothing before a fetch, then the held rows, fetching each cell once", async () => {
		vi.stubGlobal("location", { hostname: "getcache.org", port: "" });
		const get = vi.fn(async (url: string) =>
			({ ok: true, status: 200, json: async () => (url.endsWith("/145_-40.json") ? [OBERON] : []) }),
		);
		vi.stubGlobal("fetch", get);
		const cells = cellsAround(146.33, -39.06, 25);
		expect(cells).toEqual(["145_-40"]);
		expect(await heldNearby(cells)).toEqual([]);
		expect(get).not.toHaveBeenCalled();

		await fetchNearby([...cells, "0_0"]);
		await fetchNearby([...cells, "0_0"]);
		expect(get.mock.calls.map(([u]) => u)).toEqual(["/mobileAssets/nearbyPlaces/145_-40.json", "/mobileAssets/nearbyPlaces/0_0.json"]);
		expect(await heldNearby(cells)).toEqual([OBERON]);
		expect(await heldNearby(["0_0"])).toEqual([]);
	});

	it("on the phone, fetches from the web host", async () => {
		vi.stubGlobal("location", { hostname: "localhost", port: "" });
		const get = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
		vi.stubGlobal("fetch", get);
		await fetchNearby(["1_1"]);
		expect(get).toHaveBeenCalledWith("https://getcache.org/mobileAssets/nearbyPlaces/1_1.json");
	});

	it("a failed fetch keeps nothing and says so", async () => {
		vi.stubGlobal("location", { hostname: "getcache.org", port: "" });
		vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
		await expect(fetchNearby(["2_2"])).rejects.toThrow("HTTP 404");
		expect(await heldNearby(["2_2"])).toEqual([]);
	});
});
