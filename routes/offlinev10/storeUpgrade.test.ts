/** A tile store from an older build is emptied, never carried across, and the photo records go with its tiles: a record
 * that outlived them would say "baked" over ground with none, and the pass would never bake it again. */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BAKE_VERSION, getSatImageByKey } from "../../lib/onPhone/satellite/satelliteImage";
import { makeKeyedIdbStore } from "../../lib/onPhone/store/keyedIdbStore";
import { DB_NAME, getPhotoTiles, getTile, listRegions } from "./store";

describe("an older tile store", () => {
	it("is emptied, and every photo record with it", async () => {
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, 8);
			req.onupgradeneeded = () => {
				const db = req.result;
				const tiles = db.createObjectStore("tiles");
				db.createObjectStore("regions", { keyPath: "id" }).put({ id: "r1", lng: 1, lat: 2, at: 1 });
				tiles.put(new Uint8Array([1, 2]).buffer, "p/maptiler/16/10/20");
				tiles.put(new Uint8Array([3]).buffer, "13/5/6");
			};
			req.onsuccess = () => (req.result.close(), resolve());
			req.onerror = () => reject(req.error);
		});
		await makeKeyedIdbStore<object>({ dbName: "gc-offlineSatellite", storeName: "photoDiscs" }).put("piece:a:1", { bakeVersion: BAKE_VERSION, source: "MapTiler", zoom: 16 });
		expect(await getSatImageByKey("piece:a:1")).toBeDefined();

		expect((await getPhotoTiles(["16/10/20"], "maptiler")).size).toBe(0);
		expect(await getTile("13/5/6")).toBeUndefined();
		expect(await listRegions()).toEqual([]);
		expect(await getSatImageByKey("piece:a:1")).toBeUndefined();
	});
});
