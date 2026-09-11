import { describe, expect, it } from "vitest";
import {
	isRouteStale,
	type Route,
	routeAgeLabel,
	routeAgeMs,
} from "./routeContract";

const NOW = 1_757_000_000_000;
const r: Route = {
	from: [-119.5937, 49.4991],
	to: [-119.61, 49.55],
	coordinates: [
		[-119.5937, 49.4991],
		[-119.61, 49.55],
	],
	kind: "road",
	metres: 8123,
	seconds: 900,
	fetchedAt: NOW,
};

describe("how old a route is", () => {
	it("measures from when it was FETCHED, not when it was read back", () => {
		expect(routeAgeMs(r, NOW + 3600_000)).toBe(3600_000);
	});

	it("never goes negative on a clock that stepped backwards", () => {
		expect(routeAgeMs(r, NOW - 5000)).toBe(0);
	});

	it("goes stale after an hour", () => {
		expect(isRouteStale(r, NOW + 59 * 60_000)).toBe(false);
		expect(isRouteStale(r, NOW + 61 * 60_000)).toBe(true);
	});
});

describe("what the driver is told", () => {
	it("says live only when it IS live", () => {
		expect(routeAgeLabel(r, true, NOW)).toBe("Live route");
	});

	it("a saved route says both that there is no signal and how old it is", () => {
		const label = routeAgeLabel(r, false, NOW + 4 * 3600_000);
		expect(label).toContain("no signal");
		expect(label).toContain("4h ago");
	});

	it("a saved DIRECT line never calls itself a route", () => {
		const label = routeAgeLabel({ ...r, kind: "direct" }, false, NOW + 60_000);
		expect(label).toContain("direct line");
		expect(label).not.toMatch(/Saved route/);
	});

	it("reads in days once it is properly old", () => {
		expect(routeAgeLabel(r, false, NOW + 3 * 86_400_000)).toContain("3 days ago");
	});
});
