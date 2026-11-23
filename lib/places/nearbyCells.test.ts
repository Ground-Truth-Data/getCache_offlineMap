// Naming reads only cells on the phone; a cell is fetched once and kept, an empty one too, a failed one not at all,
// and the native app (localhost, no port) fetches from the web host.
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("indexedDB", new IDBFactory());
const { cellsAround, fetchNearby, heldNearby } = await import("./nearbyCells");

const OBERON = ["Oberon Bay", 146.337, -39.066, 1] as const;

describe("nearby cells", () => {
	it("reads nothing before a fetch, then the held rows, fetching each cell once", async () => {
		vi.stubGlobal("location", { hostname: "getcache.org", port: "" });
		const get = vi.fn(async (url: string) =>
			({ ok: true, status: 200, json: async () => (url.endsWith("/65_10.json") ? [OBERON] : []) }),
		);
		vi.stubGlobal("fetch", get);
		const cells = cellsAround(146.33, -39.06, 25);
		expect(cells).toEqual(["65_10"]);
		expect(await heldNearby(cells)).toEqual([]);
		expect(get).not.toHaveBeenCalled();

		await fetchNearby([...cells, "0_0"]);
		await fetchNearby([...cells, "0_0"]);
		expect(get.mock.calls.map(([u]) => u)).toEqual(["/mobileAssets/nearby/65_10.json", "/mobileAssets/nearby/0_0.json"]);
		expect(await heldNearby(cells)).toEqual([OBERON]);
		expect(await heldNearby(["0_0"])).toEqual([]);
	});

	it("on the phone, fetches from the web host", async () => {
		vi.stubGlobal("location", { hostname: "localhost", port: "" });
		const get = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
		vi.stubGlobal("fetch", get);
		await fetchNearby(["1_1"]);
		expect(get).toHaveBeenCalledWith("https://getcache.org/mobileAssets/nearby/1_1.json");
	});

	it("a failed fetch keeps nothing and says so", async () => {
		vi.stubGlobal("location", { hostname: "getcache.org", port: "" });
		vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
		await expect(fetchNearby(["2_2"])).rejects.toThrow("HTTP 404");
		expect(await heldNearby(["2_2"])).toEqual([]);
	});
});
