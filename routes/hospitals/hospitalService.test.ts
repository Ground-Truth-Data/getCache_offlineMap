import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	configureTilesHost,
	setWorkerTarget,
} from "../../lib/worker/worker-local-dev/tilesHost";
import {
	allDiscs,
	deleteDisc,
	hospitalCollection,
	hospitalKey,
} from "./hospitalCache";
import { HOSPITAL_RETRY_MS, refreshHospitals } from "./hospitalService";

const PENTICTON: [number, number] = [-119.5937, 49.4991];
const KELOWNA: [number, number] = [-119.4961, 49.888];
const WINNIPEG: [number, number] = [-97.1384, 49.8951];
const HOSPITAL = {
	type: "Feature",
	geometry: { type: "Point", coordinates: [-119.4912, 49.8881] },
	properties: { name: "Kelowna General", phone: "250-862-4000" },
};
const body = JSON.stringify({
	type: "FeatureCollection",
	features: [HOSPITAL],
});
function ok(): Response {
	return new Response(body, {
		status: 200,
		headers: { "X-Radius-Km": "500" },
	});
}

beforeEach(async () => {
	vi.useRealTimers();
	// PIN THE TIER and give it a host — the pass asks tilesHost() for the URL, and
	// nothing is baked in: an unconfigured tier answers null and the pass refuses.
	setWorkerTarget("worker-cloud-prod");
	configureTilesHost("https://tiles.example.test");
	for (const d of await allDiscs()) await deleteDisc(d.key);
});

describe("the hospital pass", () => {
	it("an anchor with no disc fetches a 500 km one, keyed on the anchor", async () => {
		const fetch = vi.fn(async (_url: string) => ok());
		vi.stubGlobal("fetch", fetch);
		expect(await refreshHospitals([PENTICTON])).toBe(1);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(String(fetch.mock.calls[0]?.[0])).toContain(
			`/hospitals?lng=${PENTICTON[0]}&lat=${PENTICTON[1]}&km=500`,
		);
		expect((await allDiscs()).map((d) => d.key)).toEqual([
			hospitalKey(...PENTICTON),
		]);
	});


	it("⛔ THE TRACTOR BUG: an anchor asked for mid-pass still gets its disc", async () => {
		// Two anchors 85 ms apart is the real case (Rosedale, 7 Sep 2026). Here the
		// first fetch is held open so the second ask lands mid-pass — the old latch
		// dropped it, and the anchor waited for a retry timer to sweep it up.
		let release!: () => void;
		const held = new Promise<void>((r) => {
			release = r;
		});
		let first = true;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				if (first) {
					first = false;
					await held;
				}
				return ok();
			}),
		);

		const a = refreshHospitals([PENTICTON]);
		const b = refreshHospitals([WINNIPEG]);
		release();
		await Promise.all([a, b]);

		expect((await allDiscs()).map((d) => d.key).sort()).toEqual(
			[hospitalKey(...PENTICTON), hospitalKey(...WINNIPEG)].sort(),
		);
	});

	it("a fresh disc is kept — nothing is fetched", async () => {
		const fetch = vi.fn(async () => ok());
		vi.stubGlobal("fetch", fetch);
		await refreshHospitals([PENTICTON]);
		expect(await refreshHospitals([PENTICTON])).toBe(0);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("a neighbouring anchor whose wall does not fit the disc gets its own", async () => {
		const fetch = vi.fn(async () => ok());
		vi.stubGlobal("fetch", fetch);
		await refreshHospitals([PENTICTON]);
		expect(await refreshHospitals([KELOWNA])).toBe(1);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("a disc over a month old is fetched again", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const fetch = vi.fn(async () => ok());
		vi.stubGlobal("fetch", fetch);
		await refreshHospitals([PENTICTON]);
		vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
		expect(await refreshHospitals([PENTICTON])).toBe(1);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("the wall: a hospital paints once, and only for anchors within 500 km", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ok()),
		);
		await refreshHospitals([PENTICTON, KELOWNA]);
		expect(await allDiscs()).toHaveLength(2);
		expect((await hospitalCollection([PENTICTON])).features).toHaveLength(1);
		expect((await hospitalCollection([WINNIPEG])).features).toHaveLength(0);
		expect((await hospitalCollection([])).features).toHaveLength(0);
	});

	it("a dead feed pauses the pass and keeps the cached discs", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ok()),
		);
		await refreshHospitals([PENTICTON]);
		const dead = vi.fn(async () => new Response("", { status: 502 }));
		vi.stubGlobal("fetch", dead);
		expect(await refreshHospitals([WINNIPEG])).toBe(0);
		expect(await refreshHospitals([WINNIPEG])).toBe(0);
		expect(dead).toHaveBeenCalledTimes(1);
		expect(await allDiscs()).toHaveLength(1);
		vi.setSystemTime(Date.now() + HOSPITAL_RETRY_MS + 1);
		await refreshHospitals([WINNIPEG]);
		expect(dead).toHaveBeenCalledTimes(2);
	});

	it("a malformed body is refused, not cached", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("<html>quota</html>", { status: 200 })),
		);
		expect(await refreshHospitals([PENTICTON])).toBe(0);
		expect(await allDiscs()).toHaveLength(0);
	});
});
