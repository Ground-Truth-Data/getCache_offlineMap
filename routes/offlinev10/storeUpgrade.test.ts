/** A phone holding a v6 tile store keeps every blob and every MapTiler tile it fetched: the upgrade only names the
 * source in each satellite tile's key, inside the upgrade's own transaction. */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DB_NAME, getPhotoTiles, getTile, listRegions } from "./store";

describe("the v6 → v7 upgrade", () => {
	it("moves p/z/x/y to p/maptiler/z/x/y and keeps the roads and the rows", async () => {
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, 6);
			req.onupgradeneeded = () => {
				const db = req.result;
				const tiles = db.createObjectStore("tiles");
				db.createObjectStore("regions", { keyPath: "id" }).put({ id: "r1", lng: 1, lat: 2, at: 1 });
				tiles.put(new Uint8Array([1, 2]).buffer, "p/16/10/20");
				tiles.put(new Uint8Array([3]).buffer, "13/5/6");
			};
			req.onsuccess = () => (req.result.close(), resolve());
			req.onerror = () => reject(req.error);
		});

		expect([...(await getPhotoTiles(["16/10/20"], "maptiler")).values()].map((b) => b.byteLength)).toEqual([2]);
		expect(await getTile("p/16/10/20")).toBeUndefined();
		expect((await getTile("13/5/6"))?.byteLength).toBe(1);
		expect((await listRegions()).map((r) => r.id)).toEqual(["r1"]);
	});
});
