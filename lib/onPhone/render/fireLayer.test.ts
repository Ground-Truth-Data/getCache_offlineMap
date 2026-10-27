// @vitest-environment happy-dom
// The offline fire renderer paints the stored discs measured from the anchors,
// drops what the legend hides, and a tap on a flame or a cluster opens a card
// with the intensity ring and the trend glyph.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overlayVisibility } from "../../mapState/overlayVisibility.svelte";
import { mapDouble } from "$gc/mapDouble";

const { FakePopup, near, places, mask } = vi.hoisted(() => {
	class FakePopup {
		static all: FakePopup[] = [];
		el = document.createElement("div");
		at: [number, number] | null = null;
		removed = 0;
		constructor(public opts: Record<string, unknown>) {
			FakePopup.all.push(this);
		}
		setLngLat(at: [number, number]) {
			return (this.at = at), this;
		}
		setHTML(html: string) {
			return (this.el.innerHTML = `<button class="maplibregl-popup-close-button"></button>${html}`), this;
		}
		addTo() {
			return this;
		}
		getElement() {
			return this.el;
		}
		remove() {
			this.removed++;
		}
	}
	return { FakePopup, near: vi.fn(), places: { rows: null as unknown[] | null, warm: vi.fn(), region: vi.fn() }, mask: { warm: vi.fn(), set: new Set<string>() } };
});
vi.mock("maplibre-gl", () => ({ Popup: FakePopup }));
vi.mock("../../../routes/fires/fireCache", async (orig) => ({ ...(await orig<object>()), fireEntriesNear: near }));
vi.mock("../../places/placeIndex", () => ({ peekPlaces: () => places.rows, warmPlaces: places.warm, setPlacesRegion: places.region }));
vi.mock("../../../routes/fires/masks/staticHeatIndex", () => ({ peekStaticMask: () => mask.set, warmStaticMask: mask.warm }));
vi.mock("../../../routes/fires/fireClassifyCache", () => ({ peekUrbanVerdict: (lng: number) => (lng === -119.9 ? true : null) }));

import { FIRE_LAYER_IDS, FIRE_LAYER_ID_LIST, attachFireLayer } from "./fireLayer";

const ANCHOR: [number, number] = [-119.5, 49.9];
const hour = 3_600_000;
const spot = (lng: number, lat: number, frp = 20, agoH = 1) => ({ coordinates: [lng, lat], t: Date.now() - agoH * hour, c: "nominal", frp });
const entry = (hotspots: unknown[], fetchedAt = Date.now() - 10 * 60_000) => ({ cacheVersion: 4, fetchedAt, center: ANCHOR, radiusKm: 500, sourcesOk: 3, hotspots, outlines: [] });

let decode = vi.fn(async () => {});
function rig() {
	const d = mapDouble();
	const images = new Map<string, unknown>();
	let resolver: ((id: string) => void) | null = null;
	Object.assign(d.raw, {
		hasImage: (id: string) => images.has(id),
		addImage: (id: string, img: unknown) => images.set(id, img),
		setMissingStyleImageResolver: (fn: ((id: string) => void) | null) => (resolver = fn),
	});
	return { d, images, resolver: () => resolver };
}
const geo = (d: ReturnType<typeof mapDouble>, id: string) => d.sources.get(id) as GeoJSON.FeatureCollection;
const tap = (d: ReturnType<typeof mapDouble>, layer: string, coordinates: number[], properties: Record<string, unknown>, type = "Point") =>
	d.fire("click", { features: [{ geometry: { type, coordinates }, properties }] }, layer);

beforeEach(() => {
	FakePopup.all = [];
	places.rows = null;
	overlayVisibility.set("fires", true);
	vi.stubGlobal("Image", class { src = ""; decode = () => decode(); });
});
afterEach(() => vi.unstubAllGlobals());

describe("attachFireLayer", () => {
	it("adds the outline under the flames, paints only the fires in reach, and follows the eye", async () => {
		near.mockResolvedValue([entry([spot(-119.4, 49.9, 50), spot(-119.41, 49.91, 40), spot(-119.9, 49.9), spot(-60, 10)])]);
		const { d, images } = rig();
		const off = attachFireLayer(d.map as never, { origins: () => [ANCHOR] });
		expect(mask.warm).toHaveBeenCalled();
		await vi.waitFor(() => expect(geo(d, FIRE_LAYER_IDS.src)?.features).toHaveLength(2));
		expect(d.layers.map((l) => l.id)).toEqual([FIRE_LAYER_IDS.outline, ...FIRE_LAYER_ID_LIST.filter((id) => id !== FIRE_LAYER_IDS.outline)]);
		expect(images.has("rt-fire-flame")).toBe(true);
		expect(near).toHaveBeenCalledWith([ANCHOR], 500);
		expect(places.region).toHaveBeenCalledWith([-119.25, 50.25]);
		const props = geo(d, FIRE_LAYER_IDS.src).features[0]!.properties!;
		expect(props.ageH).toBeCloseTo(1, 1);
		expect(props.ind).toBe(0);
		expect(geo(d, FIRE_LAYER_IDS.outlineSrc).type).toBe("FeatureCollection");
		overlayVisibility.set("fires", false);
		off.repaint();
		await vi.waitFor(() => expect(geo(d, FIRE_LAYER_IDS.src).features).toHaveLength(0));
		off();
		expect(d.handlers.get("style.load")).toHaveLength(0);
		expect(d.handlers.get(`click:${FIRE_LAYER_IDS.flame}`)).toHaveLength(0);
	});

	it("measures from the camera centre with no anchors, and re-adds itself after a style swap", async () => {
		near.mockResolvedValue([]);
		const { d, images, resolver } = rig();
		attachFireLayer(d.map as never);
		await vi.waitFor(() => expect(near).toHaveBeenCalledWith([[-119.25, 50.25]], 500));
		await vi.waitFor(() => expect(d.layers).toHaveLength(4));
		d.layers.splice(0);
		for (const id of [...d.sources.keys()]) d.raw.removeSource(id);
		images.clear();
		resolver()!("rt-fire-flame");
		expect(images.has("rt-fire-flame")).toBe(true);
		resolver()!("something-else");
		d.fire("style.load");
		await vi.waitFor(() => expect(d.layers).toHaveLength(4));
	});

	it("a tapped flame opens a hotspot card with its ring, trend and place", async () => {
		near.mockResolvedValue([entry([spot(-119.4, 49.9)])]);
		const { d } = rig();
		attachFireLayer(d.map as never, { origins: () => [ANCHOR] });
		await vi.waitFor(() => expect(d.sources.has(FIRE_LAYER_IDS.src)).toBe(true));
		tap(d, FIRE_LAYER_IDS.flame, [-119.4, 49.9], { t: Date.now() - hour, frp: 30, px: 375, ind: 0 });
		expect(places.warm).toHaveBeenCalledTimes(1);
		const p = FakePopup.all[0]!;
		expect(p.opts).toMatchObject({ className: "rt-fire-popup", closeButton: true });
		expect(p.at).toEqual([-119.4, 49.9]);
		expect(p.el.querySelector("h4")!.textContent!.length).toBeGreaterThan(0);
		expect(p.el.querySelectorAll(".rt-fire-row").length).toBeGreaterThan(1);
		expect(p.el.querySelector(".rt-fire-ring")!.getAttribute("src")).toMatch(/fire_intensity/);
		expect(p.el.querySelector(".rt-fire-trend svg")).not.toBeNull();
		places.rows = [];
		tap(d, FIRE_LAYER_IDS.flame, [-119.4, 49.9], { t: Date.now(), frp: 1, ind: 1 });
		expect(FakePopup.all[0]!.removed).toBe(1);
		const close = FakePopup.all[1]!.el.querySelector(".maplibregl-popup-close-button")!;
		close.dispatchEvent(new Event("pointerup"));
		close.dispatchEvent(new Event("pointerup"));
		expect(FakePopup.all[1]!.removed).toBe(1);
		tap(d, FIRE_LAYER_IDS.flame, [], {}, "Polygon");
		expect(FakePopup.all).toHaveLength(2);
	});

	it("a tapped cluster summarises its members, and a dead read only warns", async () => {
		near.mockResolvedValue([entry([spot(-119.4, 49.9), spot(-119.41, 49.9)])]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { d } = rig();
		const off = attachFireLayer(d.map as never, { origins: () => [ANCHOR] });
		await vi.waitFor(() => expect(d.sources.has(FIRE_LAYER_IDS.src)).toBe(true));
		const leaves = vi.fn(async () => [
			{ geometry: { type: "Point", coordinates: [-119.4, 49.9] }, properties: { t: Date.now() - 2 * hour, frp: 60 } },
			{ geometry: { type: "Point", coordinates: [-119.41, 49.9] }, properties: { t: Date.now() - hour, frp: 10 } },
			{ geometry: { type: "Polygon", coordinates: [] }, properties: {} },
		]);
		Object.assign(d.raw.getSource(FIRE_LAYER_IDS.src)!, { getClusterLeaves: leaves });
		tap(d, FIRE_LAYER_IDS.clusterIcon, [-119.405, 49.9], { cluster_id: 7, point_count: 2 });
		await vi.waitFor(() => expect(FakePopup.all).toHaveLength(1));
		expect(leaves).toHaveBeenCalledWith(7, 2, 0);
		expect(FakePopup.all[0]!.at).toEqual([-119.405, 49.9]);
		expect(FakePopup.all[0]!.el.querySelectorAll(".rt-fire-row").length).toBeGreaterThan(1);
		leaves.mockResolvedValueOnce([]);
		tap(d, FIRE_LAYER_IDS.cluster, [-119.405, 49.9], { cluster_id: 7 });
		leaves.mockRejectedValueOnce(new Error("worker gone"));
		tap(d, FIRE_LAYER_IDS.cluster, [-119.405, 49.9], { cluster_id: 8 });
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("cluster members"), expect.any(Error)));
		tap(d, FIRE_LAYER_IDS.cluster, [-119.405, 49.9], { cluster_id: "x" });
		expect(leaves).toHaveBeenCalledTimes(3);
		expect(FakePopup.all).toHaveLength(1);
		off();
		expect(FakePopup.all[0]!.removed).toBe(1);
		warn.mockRestore();
	});
});
