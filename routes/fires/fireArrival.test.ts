import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
	noteFireArrival,
	peekFireArrival,
	resetFireArrival,
	settleFireArrival,
	takeFireArrival,
} from "./fireArrival";

beforeEach(() => resetFireArrival());

describe("fireArrival — the TTL bypass", () => {
	it("is DISARMED by default — the steady state is the TTL", () => {
		expect(takeFireArrival("bake")).toBe(false);
		expect(takeFireArrival("map")).toBe(false);
	});

	it("arms on arrival", () => {
		noteFireArrival();
		expect(takeFireArrival("map")).toBe(true);
	});

	it("is CONSUMED, not merely read", () => {
		noteFireArrival();
		expect(takeFireArrival("bake")).toBe(true);
		expect(takeFireArrival("bake")).toBe(false);
		expect(takeFireArrival("bake")).toBe(false);
	});

	it("coalesces — arriving twice before a pass is still ONE refresh each", () => {
		noteFireArrival();
		noteFireArrival();
		noteFireArrival();
		expect(takeFireArrival("map")).toBe(true);
		expect(takeFireArrival("map")).toBe(false);
	});

	it("re-arms on the NEXT arrival", () => {
		noteFireArrival();
		takeFireArrival("map");
		noteFireArrival();
		expect(takeFireArrival("map")).toBe(true);
	});

	it("EACH reader gets its own — one path must never eat the other's", () => {
		noteFireArrival();
		expect(takeFireArrival("bake")).toBe(true);
		expect(takeFireArrival("map")).toBe(true);
	});

	it("consuming one path does not arm or disarm the other", () => {
		noteFireArrival();
		expect(takeFireArrival("map")).toBe(true);
		expect(takeFireArrival("map")).toBe(false);
		expect(takeFireArrival("bake")).toBe(true);
	});
});

describe("peek vs settle — the debt survives until a fetch happens", () => {
	it("peek does NOT consume", () => {
		noteFireArrival();
		expect(peekFireArrival("map")).toBe(true);
		expect(peekFireArrival("map")).toBe(true);
		expect(peekFireArrival("map")).toBe(true);
	});

	it("three racing gates all still see the debt", () => {
		noteFireArrival();
		const idleBoot = peekFireArrival("map");
		const styleLoad = peekFireArrival("map");
		const panSettle = peekFireArrival("map");
		expect([idleBoot, styleLoad, panSettle]).toEqual([true, true, true]);
	});

	it("settle clears it — so one arrival still means ONE fetch", () => {
		noteFireArrival();
		expect(peekFireArrival("map")).toBe(true);
		settleFireArrival("map");
		expect(peekFireArrival("map")).toBe(false);
	});

	it("settling the map does not settle the bake service", () => {
		noteFireArrival();
		settleFireArrival("map");
		expect(peekFireArrival("bake")).toBe(true);
		expect(takeFireArrival("bake")).toBe(true);
	});

	it("settling twice is harmless", () => {
		noteFireArrival();
		settleFireArrival("map");
		settleFireArrival("map");
		expect(peekFireArrival("map")).toBe(false);
	});
});
