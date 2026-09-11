import { describe, expect, it } from "vitest";
import { colorFor, dashFor } from "./routeLayer";
import type { Route } from "./routeContract";

const base: Route = {
	from: [-119.5937, 49.4991],
	to: [-119.61, 49.55],
	coordinates: [
		[-119.5937, 49.4991],
		[-119.61, 49.55],
	],
	kind: "road",
	metres: 8123,
	seconds: 900,
	fetchedAt: 1_757_000_000_000,
};

describe("the line's own appearance carries its honesty", () => {
	it("a live road route is solid", () => {
		expect(dashFor(base, true)).toBeUndefined();
	});

	it("a REMEMBERED road route is dashed — it must not look like the live one", () => {
		expect(dashFor(base, false)).toBeDefined();
		expect(dashFor(base, false)).not.toEqual(dashFor(base, true));
	});

	it("a direct line is dotted whether live or not — it is a heading, never a road", () => {
		const direct = { ...base, kind: "direct" as const };
		expect(dashFor(direct, true)).toEqual(dashFor(direct, false));
		expect(dashFor(direct, true)).not.toEqual(dashFor(base, true));
	});

	it("a direct line is not the road colour — colour alone must not imply a road", () => {
		expect(colorFor({ ...base, kind: "direct" })).not.toBe(colorFor(base));
	});

	it("no route is no line", () => {
		expect(dashFor(null, true)).toBeUndefined();
	});
});
