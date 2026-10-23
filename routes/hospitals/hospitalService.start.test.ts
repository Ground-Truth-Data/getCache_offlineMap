// @vitest-environment happy-dom
// The hospital pass runs at start, when the anchors change, when a map asks
// for a spot, on coming back online and on coming to the front; listeners
// hear each disc land; a missing host or a non-FeatureCollection is an error,
// and a Worker that names no radius served 200 km.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureTilesHost, setWorkerTarget } from "../../lib/worker/tilesHost";
import { notifyHospitals, onHospitals, readDisc, wantHospitals } from "./hospitalCache";
import { fetchHospitals, startHospitalService } from "./hospitalService";

const FC = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: {} }] });
const fetchMock = vi.fn(async (_u: string, _o?: RequestInit) => new Response(FC, { status: 200 }));
const spots: Array<[number, number]> = [[-60, 10], [-50, 10], [-40, 10], [-30, 10], [-20, 10]];

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
	vi.spyOn(console, "info").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchHospitals", () => {
	it("refuses before a host is configured, then reads the disc and its radius", async () => {
		await expect(fetchHospitals(1, 2)).rejects.toThrow("no tiles host configured");
		configureTilesHost("https://tiles.test");
		setWorkerTarget("worker-cloud-prod");
		const r = await fetchHospitals(1, 2);
		expect(r).toEqual({ geojson: FC, count: 1, radiusKm: 200 });
		expect(fetchMock.mock.calls[0]![1]).toMatchObject({ cache: "no-store" });
		fetchMock.mockResolvedValueOnce(new Response(FC, { headers: { "X-Radius-Km": "80" } }));
		expect((await fetchHospitals(1, 2)).radiusKm).toBe(80);
		fetchMock.mockResolvedValueOnce(new Response("{\"type\":\"Feature\"}"));
		await expect(fetchHospitals(1, 2)).rejects.toThrow("malformed FeatureCollection");
		fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
		await expect(fetchHospitals(1, 2)).rejects.toThrow("responded 502");
	});
});

describe("startHospitalService", () => {
	it("passes on every wake-up, hears a map's ask, and only its first start owns shutdown", async () => {
		configureTilesHost("https://tiles.test");
		let anchors: Array<[number, number]> = [spots[0]!];
		let changed: (() => void) | null = null;
		const offAnchors = vi.fn();
		const heard = vi.fn();
		const offHeard = onHospitals(heard);
		const stop = startHospitalService({ anchors: () => anchors, onAnchorsChanged: (r) => ((changed = r), offAnchors) });
		startHospitalService({ anchors: () => [] })();
		await vi.waitFor(async () => expect(await readDisc("-60.0000,10.0000")).toBeDefined());

		anchors = [spots[1]!];
		changed!();
		await vi.waitFor(async () => expect(await readDisc("-50.0000,10.0000")).toBeDefined());
		wantHospitals([spots[2]!]);
		await vi.waitFor(async () => expect(await readDisc("-40.0000,10.0000")).toBeDefined());
		anchors = [spots[3]!];
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(async () => expect(await readDisc("-30.0000,10.0000")).toBeDefined());
		anchors = [spots[4]!];
		Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.waitFor(async () => expect(await readDisc("-20.0000,10.0000")).toBeDefined());
		expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[hospitals\] 1 within 200 km of 10\.0000,-60\.0000/));

		notifyHospitals();
		expect(heard).toHaveBeenCalled();
		offHeard();
		heard.mockClear();
		notifyHospitals();
		expect(heard).not.toHaveBeenCalled();

		stop();
		expect(offAnchors).toHaveBeenCalledTimes(1);
		fetchMock.mockClear();
		anchors = [[0, -60]];
		window.dispatchEvent(new Event("online"));
		wantHospitals([[0, -60]]);
		await new Promise((r) => setTimeout(r, 10));
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
