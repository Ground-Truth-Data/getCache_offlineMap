// @vitest-environment happy-dom
// The saved camera and the framed-map key: written on moveend, read back
// north-up, never at Null Island, and a broken store reads as nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyCameraOrientation, attachCameraPersistence, loadCamera, loadFramedMapKey, saveFramedMapKey } from "./mapViewport";

function cameraMap(lng: number, lat: number, zoom: number) {
	const handlers = new Map<string, () => void>();
	return {
		handlers,
		getCenter: () => ({ lng, lat }),
		getZoom: () => zoom,
		getBearing: () => 30,
		getPitch: () => 40,
		setBearing: vi.fn(),
		setPitch: vi.fn(),
		on: (t: string, fn: () => void) => void handlers.set(t, fn),
		off: (t: string) => void handlers.delete(t),
	};
}
beforeEach(() => localStorage.clear());

describe("camera persistence", () => {
	it("saves on moveend until detached, and skips Null Island and a non-finite zoom", () => {
		const m = cameraMap(-119.6, 49.5, 11);
		const detach = attachCameraPersistence(m);
		m.handlers.get("moveend")!();
		expect(loadCamera()).toEqual({ center: [-119.6, 49.5], zoom: 11, bearing: 0, pitch: 0 });
		detach();
		expect(m.handlers.size).toBe(0);
		const island = cameraMap(0.1, 0.1, 9);
		attachCameraPersistence(island);
		island.handlers.get("moveend")!();
		const nan = cameraMap(-100, 40, Number.NaN);
		attachCameraPersistence(nan);
		nan.handlers.get("moveend")!();
		expect(loadCamera()!.center).toEqual([-119.6, 49.5]);
	});

	it("reads junk as no camera and asserts north-up on a live map", () => {
		localStorage.setItem("retreever-map-camera", "{bad");
		expect(loadCamera()).toBeNull();
		localStorage.setItem("retreever-map-camera", JSON.stringify({ center: [1, "x"], zoom: 3, bearing: 0, pitch: 0 }));
		expect(loadCamera()).toBeNull();
		const m = cameraMap(1, 1, 1);
		applyCameraOrientation(m, { center: [1, 1], zoom: 1, bearing: 90, pitch: 50 });
		expect(m.setBearing).toHaveBeenCalledWith(0);
		expect(m.setPitch).toHaveBeenCalledWith(0);
	});
});

describe("framed map key", () => {
	it("round-trips a key, ignores null, and reads null when storage throws", () => {
		expect(loadFramedMapKey()).toBeNull();
		saveFramedMapKey("map-7");
		saveFramedMapKey(null);
		expect(loadFramedMapKey()).toBe("map-7");
		const blocked = () => {
			throw new Error("blocked");
		};
		const get = vi.fn(blocked);
		vi.stubGlobal("localStorage", { getItem: get, setItem: blocked });
		expect(loadFramedMapKey()).toBeNull();
		expect(loadCamera()).toBeNull();
		saveFramedMapKey("map-8");
		const m = cameraMap(-119, 49, 5);
		attachCameraPersistence(m);
		m.handlers.get("moveend")!();
		expect(get).toHaveBeenCalledTimes(2);
		vi.unstubAllGlobals();
	});
});
