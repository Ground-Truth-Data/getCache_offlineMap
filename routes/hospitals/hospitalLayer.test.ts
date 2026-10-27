// @vitest-environment happy-dom
// Hospital pins paint from the cache once the pin icon is in, hide with the
// legend's eye, and a tap opens a card measured from the user's anchors whose
// phone number copies rather than dials.
import { distance } from "$gc/units.svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overlayVisibility } from "../../lib/mapState/overlayVisibility.svelte";
import { mapDouble } from "$gc/mapDouble";

const { FakePopup, cache } = vi.hoisted(() => {
	class FakePopup {
		static all: FakePopup[] = [];
		el = document.createElement("div");
		at: [number, number] | null = null;
		removed = 0;
		constructor(public opts: Record<string, unknown>) {
			FakePopup.all.push(this);
		}
		setLngLat(at: [number, number]) {
			this.at = at;
			return this;
		}
		setHTML(html: string) {
			this.el.innerHTML = `<button class="maplibregl-popup-close-button"></button>${html}`;
			return this;
		}
		addTo() {
			document.body.appendChild(this.el);
			return this;
		}
		getElement() {
			return this.el;
		}
		remove() {
			this.removed++;
			this.el.remove();
		}
	}
	const landed = new Set<() => void>();
	return {
		FakePopup,
		cache: {
			landed,
			wantHospitals: vi.fn(),
			hospitalCollection: vi.fn(async () => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Kelowna General" }, geometry: { type: "Point", coordinates: [-119.4, 49.9] } }] })),
		},
	};
});
vi.mock("maplibre-gl", () => ({ Popup: FakePopup, Marker: class {} }));
vi.mock("./hospitalCache", () => ({
	hospitalCollection: cache.hospitalCollection,
	wantHospitals: cache.wantHospitals,
	onHospitals: (fn: () => void) => (cache.landed.add(fn), () => void cache.landed.delete(fn)),
}));

import { useMapbox } from "../../lib/shared/rendererOf";
import { HOSPITAL_LAYER_IDS, attachHospitalLayer, hospitalCardHtml } from "./hospitalLayer";

const ORIGIN: [number, number] = [-119.5, 49.9];
const settle = () => vi.waitFor(() => expect(cache.hospitalCollection).toHaveBeenCalled());

function rig(kind: "maplibre" | "mapbox" = "maplibre") {
	const d = mapDouble();
	if (kind === "maplibre") d.container.className = "maplibregl-map";
	const images = new Set<string>();
	Object.assign(d.raw, {
		hasImage: (id: string) => images.has(id),
		addImage: vi.fn((id: string) => images.add(id)),
		loadImage:
			kind === "maplibre"
				? vi.fn(async () => ({ data: { width: 1 } }))
				: vi.fn((_u: string, cb: (e: Error | null, img?: unknown) => void) => cb(null, { width: 1 })),
	});
	return { d, images };
}
const point = (lng: number, lat: number, properties: Record<string, unknown> | null = {}) => ({ features: [{ geometry: { type: "Point", coordinates: [lng, lat] }, properties }] });

beforeEach(() => {
	FakePopup.all = [];
	distance.value = "metric";
	overlayVisibility.set("hospitals", true);
});
afterEach(() => {
	document.body.innerHTML = "";
});

describe("hospitalCardHtml", () => {
	it("escapes the name, rounds the distance in the chosen unit, and offers the locate button", () => {
		const html = hospitalCardHtml({ name: "St <Mary's>", er: true, phone: "250-555-0100", fromYouKm: 12.4, locateButton: true });
		const el = Object.assign(document.createElement("div"), { innerHTML: html });
		expect(el.querySelector("h4")!.textContent).toBe("St <Mary's>");
		expect(el.querySelectorAll("[data-copy]")).toHaveLength(2);
		expect(el.querySelector(".rt-hospital-tel")!.textContent).toBe("250-555-0100");
		expect(el.textContent).toMatch(/12 km/);
		expect(el.querySelector(".rt-hospital-loc")).not.toBeNull();
		const bare = Object.assign(document.createElement("div"), { innerHTML: hospitalCardHtml({ name: "X", er: true, fromYouKm: Number.NaN, locateButton: false }) });
		expect(bare.querySelector("[data-copy]")).toBeNull();
		expect(bare.querySelector(".rt-hospital-loc")).toBeNull();
		expect(bare.querySelectorAll(".rt-hospital-row")).toHaveLength(0);
	});

	it("says the ER is not confirmed when OSM never tagged emergency=yes", () => {
		const el = Object.assign(document.createElement("div"), { innerHTML: hospitalCardHtml({ name: "Gove", er: false, locateButton: false }) });
		expect(el.textContent).toContain("Hospital — ER not confirmed");
		expect(el.querySelector("img")!.getAttribute("src")).toMatch(/Unconfirmed/);
	});
});

describe("attachHospitalLayer", () => {
	it("loads the pin, paints the cached collection, follows the eye, and asks for hospitals at the anchors", async () => {
		const { d, images } = rig();
		const off = attachHospitalLayer(d.map as never, { origins: () => [ORIGIN] });
		await settle();
		await vi.waitFor(() => expect(d.layers.map((l) => l.id)).toEqual([HOSPITAL_LAYER_IDS.cluster, HOSPITAL_LAYER_IDS.icon]));
		expect(images.has("rt-hospital-pin")).toBe(true);
		expect((d.sources.get(HOSPITAL_LAYER_IDS.src) as { features: unknown[] }).features).toHaveLength(1);
		expect(cache.wantHospitals).toHaveBeenCalledWith([ORIGIN]);
		expect(d.layout[HOSPITAL_LAYER_IDS.icon]!.visibility).toBe("visible");
		overlayVisibility.set("hospitals", false);
		off.repaint();
		expect(d.layout[HOSPITAL_LAYER_IDS.cluster]!.visibility).toBe("none");
		expect(cache.wantHospitals).toHaveBeenCalledTimes(2);
		cache.landed.forEach((fn) => fn());
		d.fire("styledata");
		await vi.waitFor(() => expect(cache.hospitalCollection.mock.calls.length).toBeGreaterThanOrEqual(3));
		off();
		expect(cache.landed.size).toBe(0);
		expect(d.handlers.get("styledata")).toHaveLength(0);
		expect(d.handlers.get(`click:${HOSPITAL_LAYER_IDS.icon}`)).toHaveLength(0);
	});

	it("a tapped pin opens the card from the nearest anchor; copy, locate and close all work", async () => {
		const { d } = rig();
		const onShowMyLocation = vi.fn();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		attachHospitalLayer(d.map as never, { origins: () => [ORIGIN, [-100, 40]], onShowMyLocation, hauls: false });
		expect(cache.wantHospitals).not.toHaveBeenCalled();
		d.fire("click", point(-119.4, 49.9, { name: "Kelowna General", phone: "250-555-0100" }), HOSPITAL_LAYER_IDS.icon);
		const p = FakePopup.all[0]!;
		expect(p.opts).toMatchObject({ className: "rt-hospital-popup", closeButton: true });
		expect(p.at).toEqual([-119.4, 49.9]);
		expect(p.el.querySelector("h4")!.textContent).toBe("Kelowna General");
		expect(p.el.textContent).toMatch(/7 km/);
		vi.useFakeTimers();
		p.el.querySelector<HTMLButtonElement>(".rt-hospital-copy")!.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(writeText).toHaveBeenCalledWith("250-555-0100");
		expect(p.el.querySelector(".rt-hospital-copy")!.classList.contains("is-copied")).toBe(true);
		await vi.advanceTimersByTimeAsync(1400);
		expect(p.el.querySelector(".rt-hospital-copy")!.classList.contains("is-copied")).toBe(false);
		vi.useRealTimers();
		writeText.mockRejectedValueOnce(new Error("denied"));
		document.execCommand = vi.fn(() => true);
		p.el.querySelector<HTMLButtonElement>(".rt-hospital-tel")!.click();
		await vi.waitFor(() => expect(document.execCommand).toHaveBeenCalledWith("copy"));
		p.el.querySelector<HTMLButtonElement>(".rt-hospital-loc")!.click();
		expect(onShowMyLocation).toHaveBeenCalledTimes(1);
		expect(p.removed).toBe(1);
		d.fire("click", point(-119.4, 49.9, null), HOSPITAL_LAYER_IDS.icon);
		const q = FakePopup.all[1]!;
		expect(q.el.querySelector("h4")!.textContent!.length).toBeGreaterThan(0);
		const close = q.el.querySelector<HTMLButtonElement>(".maplibregl-popup-close-button")!;
		close.dispatchEvent(new Event("pointerup"));
		close.dispatchEvent(new Event("pointerup"));
		expect(q.removed).toBe(1);
		d.fire("click", { features: [{ geometry: { type: "Polygon", coordinates: [] } }] }, HOSPITAL_LAYER_IDS.icon);
		expect(FakePopup.all).toHaveLength(2);
	});

	it("a tapped cluster names its first member, on either renderer", async () => {
		const { d } = rig();
		attachHospitalLayer(d.map as never, { origins: () => [ORIGIN] });
		await vi.waitFor(() => expect(d.raw.getSource(HOSPITAL_LAYER_IDS.src)).toBeDefined());
		const leaf = { type: "Feature", properties: { name: "Penticton Regional" }, geometry: { type: "Point", coordinates: [-119.6, 49.5] } };
		Object.assign(d.raw.getSource(HOSPITAL_LAYER_IDS.src)!, { getClusterLeaves: vi.fn(async () => [leaf]) });
		d.fire("click", point(-119.5, 49.6, { cluster_id: 4 }), HOSPITAL_LAYER_IDS.cluster);
		await vi.waitFor(() => expect(FakePopup.all).toHaveLength(1));
		expect(FakePopup.all[0]!.at).toEqual([-119.6, 49.5]);
		expect(FakePopup.all[0]!.el.querySelector("h4")!.textContent).toBe("Penticton Regional");
		d.fire("click", point(-119.5, 49.6, {}), HOSPITAL_LAYER_IDS.cluster);
		expect(FakePopup.all[1]!.at).toEqual([-119.5, 49.6]);

		useMapbox({ Popup: FakePopup, Marker: class {} } as never);
		const mb = rig("mapbox").d;
		attachHospitalLayer(mb.map as never, { origins: () => [ORIGIN] });
		await vi.waitFor(() => expect(mb.raw.getSource(HOSPITAL_LAYER_IDS.src)).toBeDefined());
		Object.assign(mb.raw.getSource(HOSPITAL_LAYER_IDS.src)!, { getClusterLeaves: (_i: number, _l: number, _o: number, cb: (e: unknown, l?: unknown[]) => void) => cb(new Error("gone")) });
		mb.fire("click", point(-119.5, 49.6, { cluster_id: 4 }), HOSPITAL_LAYER_IDS.cluster);
		expect(FakePopup.all[2]!.at).toEqual([-119.5, 49.6]);
	});

	it("warns and paints nothing when the pin icon never loads", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { d } = rig();
		d.raw.loadImage = vi.fn(async () => {
			throw new Error("404");
		}) as never;
		attachHospitalLayer(d.map as never, { origins: () => [ORIGIN] });
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("pin icon failed"), expect.any(Error)));
		d.fire("styledata");
		await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("reload failed"), expect.any(Error)));
		warn.mockRestore();
	});
});
