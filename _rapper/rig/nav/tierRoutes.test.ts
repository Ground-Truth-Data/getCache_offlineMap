import { describe, expect, it } from "vitest";
import {
	TIER_HOME,
	currentRepo,
	otherTierPath,
	servesOtherSide,
} from "./tierRoutes";
import type { TierRoute } from "./tierRoutes";

const RETREEVER: TierRoute[] = [
	{ path: "/who", otherPath: "/who", repo: "ReTreever_who_what" },
	{ path: "/what", otherPath: "/what", repo: "ReTreever_who_what" },
	{ path: "/app/offline", otherPath: "/app/offline", repo: "getCache_OfflineMap" },
	{ path: "/where", repo: "getCache_OfflineMap" },
];

/** A rapper install carrying who_what: one child, mounted at "/". */
const RAPPER: TierRoute[] = [
	{ path: "/", otherPath: "/who", repo: "ReTreever_who_what" },
];

describe("otherTierPath", () => {
	it("carries the current view across, not a fixed page", () => {
		expect(otherTierPath("/what", RETREEVER)).toBe("/what");
		expect(otherTierPath("/app/offline", RETREEVER)).toBe("/app/offline");
	});

	it("resolves a nested route through its parent entry", () => {
		expect(otherTierPath("/who/acme", RETREEVER)).toBe("/who");
		expect(otherTierPath("/app/offline/tiles", RETREEVER)).toBe("/app/offline");
	});

	it("falls back to home when the other tier has no counterpart", () => {
		expect(otherTierPath("/where", RETREEVER)).toBe(TIER_HOME);
	});

	it("falls back to home for a route that is not listed at all", () => {
		expect(otherTierPath("/legal", RETREEVER)).toBe(TIER_HOME);
	});

	it("maps rapper's single mount back to a real ReTreever route", () => {
		expect(otherTierPath("/", RAPPER)).toBe("/who");
	});

	it("does not let a '/' entry swallow every other path", () => {
		expect(otherTierPath("/app/debug", RAPPER)).toBe(TIER_HOME);
	});

	it("prefers the longest matching prefix, not declaration order", () => {
		const nested: TierRoute[] = [
			{ path: "/where", otherPath: "/a" },
			{ path: "/where/debug", otherPath: "/b" },
		];
		expect(otherTierPath("/where/debug", nested)).toBe("/b");
		expect(otherTierPath("/where/else", nested)).toBe("/a");
	});

	it("does not match a path that merely shares a prefix string", () => {
		expect(otherTierPath("/whopper", RETREEVER)).toBe(TIER_HOME);
	});
});

describe("currentRepo", () => {
	it("names the repo for the view you are on, not the mount", () => {
		expect(currentRepo("/who", RETREEVER)).toBe("ReTreever_who_what");
		expect(currentRepo("/app/offline", RETREEVER)).toBe("getCache_OfflineMap");
	});

	it("is undefined where no child backs the route", () => {
		expect(currentRepo("/legal", RETREEVER)).toBeUndefined();
	});
});

describe("otherTierPath — the other tier's landing route", () => {
	it("uses the caller's landing route instead of '/' when nothing matches", () => {
		expect(otherTierPath("/app/map", RAPPER, "/who")).toBe("/who");
		expect(otherTierPath("/legal", RETREEVER, "/somewhere")).toBe("/somewhere");
	});

	it("uses it for a listed route that has no counterpart", () => {
		expect(otherTierPath("/where", RETREEVER, "/who")).toBe("/who");
	});

	it("still prefers a real mapping over the landing route", () => {
		expect(otherTierPath("/what", RETREEVER, "/who")).toBe("/what");
		expect(otherTierPath("/", RAPPER, "/nope")).toBe("/who");
	});

	it("falls back to TIER_HOME when no landing route is supplied", () => {
		expect(otherTierPath("/legal", RETREEVER)).toBe(TIER_HOME);
		expect(otherTierPath("/legal", RETREEVER, undefined)).toBe(TIER_HOME);
	});
});

describe("the tier hop round-trips", () => {
	const RAPPER_BIJECTIVE: TierRoute[] = [
		{ path: "/who", otherPath: "/who" },
		{ path: "/what", otherPath: "/what" },
	];

	it("returns you to the page you left, for every mapped route", () => {
		for (const here of ["/who", "/what"]) {
			const there = otherTierPath(here, RETREEVER);
			expect(otherTierPath(there, RAPPER_BIJECTIVE)).toBe(here);
		}
	});

	it("/what no longer collapses onto /who", () => {
		expect(otherTierPath("/who", RETREEVER)).not.toBe(
			otherTierPath("/what", RETREEVER),
		);
	});

	it("maps each view to a DISTINCT counterpart — no many-to-one", () => {
		const mapped = RAPPER_BIJECTIVE.map((r) => r.otherPath);
		expect(new Set(mapped).size).toBe(mapped.length);
	});
});

describe("servesOtherSide", () => {
	it("is true only for a row that declares a counterpart", () => {
		expect(servesOtherSide("/who", RETREEVER)).toBe(true);
		expect(servesOtherSide("/what", RETREEVER)).toBe(true);
	});

	it("is false for a listed route the other tier does not serve", () => {
		expect(servesOtherSide("/where", RETREEVER)).toBe(false);
	});

	it("is false for a route nobody has heard of", () => {
		expect(servesOtherSide("/legal", RETREEVER)).toBe(false);
	});

	it("resolves through a parent entry like the other helpers do", () => {
		expect(servesOtherSide("/who/acme", RETREEVER)).toBe(true);
	});
});
