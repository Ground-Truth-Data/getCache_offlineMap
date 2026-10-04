import { describe, expect, it, vi } from "vitest";

// Same disc as the real module, without its IndexedDB store chain.
vi.mock("./satelliteImage", () => ({
    PHOTO_COVERAGE_RADIUS_KM: 2,
    getSatImageByKey: vi.fn(),
}));

import {
    type PhotoSite,
    photoCullPlan,
    SAT_MIN_Z,
    SAT_MOUNT_VIEWPORTS,
    SAT_UNMOUNT_VIEWPORTS,
} from "./mountSatellite";

/** A site's key is whatever its record stores; the cull only carries it. */
const site = (lng: number, lat: number): PhotoSite => ({ key: `k${lng},${lat}`, center: [lng, lat] });

describe("photoCullPlan (the viewport cull)", () => {
    // 2° camera at the equator: mount ring [-3,-3,3,3], keep ring [-5,-5,5,5].
    const camera: [number, number, number, number] = [-1, -1, 1, 1];

    it("keeps the ring constants ordered — unmount wider than mount, or photos flap on the edge", () => {
        expect(SAT_UNMOUNT_VIEWPORTS).toBeGreaterThan(SAT_MOUNT_VIEWPORTS);
    });

    it("mounts the photo the camera is sitting on, at the floor and above", () => {
        const here = site(0, 0);
        const p = photoCullPlan(camera, [here], SAT_MIN_Z);
        expect(p.mount).toEqual([here]);
        expect(p.keep.has(here.key)).toBe(true);
        expect(photoCullPlan(camera, [here], 16).mount).toEqual([here]);
    });

    it("below the floor the plan is EMPTY on both sides — nothing mounts, everything mounted is swept", () => {
        const p = photoCullPlan(camera, [site(0, 0), site(2.5, 0)], SAT_MIN_Z - 0.01);
        expect(p.mount).toEqual([]);
        expect(p.keep.size).toBe(0);
    });

    it("pre-mounts one viewport out — a panning user must never watch a photo pop in (Law 3)", () => {
        const out = site(2.5, 0);
        const p = photoCullPlan(camera, [out]);
        expect(p.mount).toEqual([out]);
        expect(p.keep.has(out.key)).toBe(true);
    });

    it("counts the 2 km disc's EDGE, not the pin — a photo whose rim overlaps the mount ring mounts", () => {
        // The pin is past 3°, but the disc (±0.0180° at the equator) reaches back inside.
        const rim = site(3.01, 0);
        const p = photoCullPlan(camera, [rim]);
        expect(p.mount).toEqual([rim]);
    });

    it("holds a mounted photo in the hysteresis band — kept but not (re)mounted between the rings", () => {
        const band = site(4, 0);
        const p = photoCullPlan(camera, [band]);
        expect(p.mount).toEqual([]);
        expect(p.keep.has(band.key)).toBe(true);
    });

    it("drops a photo beyond the keep ring — the sweep unmounts it and revokes the URL", () => {
        const p = photoCullPlan(camera, [site(6, 0)]);
        expect(p.mount).toEqual([]);
        expect(p.keep.size).toBe(0);
    });

    it("stretches the lng span with latitude — the same disc is wider at 60°N", () => {
        // At the equator the disc reaches 3.002°, past the ring; at 60°N it reaches 2.984°.
        const equator = photoCullPlan([-1, -1, 1, 1], [site(3.02, 0)]);
        const northSite = site(3.02, 60);
        const north = photoCullPlan([-1, 59, 1, 61], [northSite]);
        expect(equator.mount).toEqual([]);
        expect(north.mount).toEqual([northSite]);
    });

    it("a world-spanning camera at the floor mounts EVERYTHING — the cull is geometry above the floor", () => {
        const world: [number, number, number, number] = [-170, -80, 170, 80];
        const sites = [site(0, 0), site(100, 50), site(-150, -70), site(179.9, 0)];
        const p = photoCullPlan(world, sites);
        expect(p.mount).toHaveLength(4);
        expect(p.keep.size).toBe(4);
    });

    it("no sites, no plan — and no crash", () => {
        const p = photoCullPlan(camera, []);
        expect(p.mount).toEqual([]);
        expect(p.keep.size).toBe(0);
    });
});
