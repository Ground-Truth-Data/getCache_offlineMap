/**
 * THE PILL MUST LAND ON THE PAGE YOU ARE ON.
 *
 * These cases are the bug, written down. Before tierRoutes.ts existed the
 * destination was a build-time constant, so every one of the "carries the
 * current view across" cases returned the same fixed path — /who under rapper,
 * / under ReTreever — regardless of where you actually were.
 */
import { describe, expect, it } from "vitest";
import {
	TIER_HOME,
	currentRepo,
	otherTierPath,
	servesOtherSide,
} from "./tierRoutes";
import type { TierRoute } from "./tierRoutes";

/** ReTreever's real table: two search tabs plus the offline map child. */
const RETREEVER: TierRoute[] = [
	// One-to-one, as the real table now is: the child serves both views.
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
		// THE BUG: both of these used to return "/" — the hardcoded otherPath.
		expect(otherTierPath("/what", RETREEVER)).toBe("/what");
		expect(otherTierPath("/app/offline", RETREEVER)).toBe("/app/offline");
	});

	it("resolves a nested route through its parent entry", () => {
		expect(otherTierPath("/who/acme", RETREEVER)).toBe("/who");
		expect(otherTierPath("/app/offline/tiles", RETREEVER)).toBe("/app/offline");
	});

	it("falls back to home when the other tier has no counterpart", () => {
		// /where is listed but carries no otherPath — rapper serves nothing there.
		expect(otherTierPath("/where", RETREEVER)).toBe(TIER_HOME);
	});

	it("falls back to home for a route that is not listed at all", () => {
		expect(otherTierPath("/legal", RETREEVER)).toBe(TIER_HOME);
	});

	it("maps rapper's single mount back to a real ReTreever route", () => {
		expect(otherTierPath("/", RAPPER)).toBe("/who");
	});

	it("does not let a '/' entry swallow every other path", () => {
		// "/" is a prefix of everything; matched as a prefix it would win the
		// fallback for unlisted routes and hide them.
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
		// /whopper is not under /who.
		expect(otherTierPath("/whopper", RETREEVER)).toBe(TIER_HOME);
	});
});

describe("currentRepo", () => {
	it("names the repo for the view you are on, not the mount", () => {
		// THE BUG: the GH link was a fixed {repo} prop, so /offline showed
		// ReTreever_who_what.
		expect(currentRepo("/who", RETREEVER)).toBe("ReTreever_who_what");
		expect(currentRepo("/app/offline", RETREEVER)).toBe("getCache_OfflineMap");
	});

	it("is undefined where no child backs the route", () => {
		expect(currentRepo("/legal", RETREEVER)).toBeUndefined();
	});
});

/**
 * THE FALLBACK IS A TIER'S FACT, NOT A CONSTANT.
 *
 * `TIER_HOME` was "/" for everyone. That is right for rapper, which serves its
 * one child at "/", and WRONG for ReTreever, which answers "/" with a marketing
 * homepage and serves the search at /who. So standing on rapper's /map and
 * switching tiers landed on dt-web's landing page — a working page, not the
 * work. These pin the parameter that fixes it.
 */
describe("otherTierPath — the other tier's landing route", () => {
	it("uses the caller's landing route instead of '/' when nothing matches", () => {
		expect(otherTierPath("/app/map", RAPPER, "/who")).toBe("/who");
		expect(otherTierPath("/legal", RETREEVER, "/somewhere")).toBe("/somewhere");
	});

	it("uses it for a listed route that has no counterpart", () => {
		// /where is listed with no otherPath — rapper serves nothing there.
		expect(otherTierPath("/where", RETREEVER, "/who")).toBe("/who");
	});

	it("still prefers a real mapping over the landing route", () => {
		// A landing route must never override a route that DOES map.
		expect(otherTierPath("/what", RETREEVER, "/who")).toBe("/what");
		expect(otherTierPath("/", RAPPER, "/nope")).toBe("/who");
	});

	it("falls back to TIER_HOME when no landing route is supplied", () => {
		// A child cloned alone gets undefined from its absent parent config.
		expect(otherTierPath("/legal", RETREEVER)).toBe(TIER_HOME);
		expect(otherTierPath("/legal", RETREEVER, undefined)).toBe(TIER_HOME);
	});
});

/**
 * THE RETURN TRIP, WITHOUT A CARRIER.
 *
 * Standing on /what, switching tiers, and switching back landed on /who — the
 * bug that a `?rtvrFrom=` query stamp was built to paper over. The stamp is
 * deleted: the child now serves /who and /what itself, so each row maps one
 * page to exactly one page and the inverse is just another lookup.
 *
 * These assert the property that makes the carrier unnecessary — go across,
 * come back, arrive where you started.
 */
describe("the tier hop round-trips", () => {
	/** rapper's table, now that its child serves both views at real paths. */
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
		// THE BUG, as a test: these two must not share a destination, or the
		// return trip cannot tell them apart and has to guess.
		expect(otherTierPath("/who", RETREEVER)).not.toBe(
			otherTierPath("/what", RETREEVER),
		);
	});

	it("maps each view to a DISTINCT counterpart — no many-to-one", () => {
		const mapped = RAPPER_BIJECTIVE.map((r) => r.otherPath);
		expect(new Set(mapped).size).toBe(mapped.length);
	});
});

/**
 * THE PILL MUST BE ABLE TO TELL A MAPPING FROM A SUBSTITUTION.
 *
 * Both come back from otherTierPath as a plain string, so without this the
 * caller cannot distinguish "rapper serves this at /" from "rapper serves
 * nothing here, have its home" — and it silently performs a swap it never
 * announced. These pin the difference.
 */
describe("servesOtherSide", () => {
	it("is true only for a row that declares a counterpart", () => {
		expect(servesOtherSide("/who", RETREEVER)).toBe(true);
		expect(servesOtherSide("/what", RETREEVER)).toBe(true);
	});

	it("is false for a listed route the other tier does not serve", () => {
		// /where is listed (so the GitHub link works) but has no otherPath.
		expect(servesOtherSide("/where", RETREEVER)).toBe(false);
	});

	it("is false for a route nobody has heard of", () => {
		expect(servesOtherSide("/legal", RETREEVER)).toBe(false);
	});

	it("resolves through a parent entry like the other helpers do", () => {
		expect(servesOtherSide("/who/acme", RETREEVER)).toBe(true);
	});
});
