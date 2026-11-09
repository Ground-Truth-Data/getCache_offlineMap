import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeOf } from "../shared/workMeter.svelte";
import {
	configureTilesDevHost,
	configureTilesHost,
	configureWifiCheck,
	DEFAULT_TARGET,
	firesUrl,
	getWorkerTarget,
	hospitalsUrl,
	LOCAL_DEV_HOST,
	onWifi,
	probeTarget,
	satelliteTileUrl,
	setWorkerTarget,
	squirrelUrl,
	tilesHost,
	tileUrl,
	whereUrl,
} from "./tilesHost";

/** A .test domain: a copied test can never hit a real request. */
const TEST_HOST = "https://tiles.example.test";

beforeEach(() => {
	sessionStorage.clear();
	configureTilesHost(TEST_HOST);
});

describe("worker target", () => {
	it("follows its own tier's default, with no stored override", () => {
		// Asserted against DEFAULT_TARGET, not a literal: this file is shared by all three tiers.
		expect(getWorkerTarget()).toBe(DEFAULT_TARGET);
		const prodTier = DEFAULT_TARGET === "worker-cloud-prod";
		expect(tilesHost()).toBe(prodTier ? TEST_HOST : null);
		configureTilesDevHost("https://tiles-dev.example.test");
		expect(tilesHost()).toBe(
			prodTier ? TEST_HOST : "https://tiles-dev.example.test",
		);
	});

	it("switches every URL together — no split-brain", () => {
		setWorkerTarget("worker-local-dev");
		expect(tilesHost()).toBe(LOCAL_DEV_HOST);
		expect(firesUrl()).toBe(`${LOCAL_DEV_HOST}/fires`);

		setWorkerTarget("worker-cloud-prod");
		expect(firesUrl()).toBe(`${TEST_HOST}/fires`);
	});

	it("URLs are read per call, so a switch takes effect without a reload", () => {
		setWorkerTarget("worker-cloud-prod");
		const before = firesUrl();
		setWorkerTarget("worker-local-dev");
		expect(firesUrl()).not.toBe(before);
	});

	it("ignores a corrupt or hostile stored value", () => {
		sessionStorage.setItem("rt_worker_target", "https://evil.example.com");
		expect(getWorkerTarget()).toBe(DEFAULT_TARGET);
		expect(tilesHost()).not.toBe("https://evil.example.com");
	});

	it("the override is gated on import.meta.env.DEV in BOTH directions", () => {
		const src = readSource();
		const reader = src.slice(src.indexOf("export function getWorkerTarget"));
		expect(reader.slice(0, 200)).toContain("import.meta.env.DEV");
		const writer = src.slice(src.indexOf("export function setWorkerTarget"));
		expect(writer.slice(0, 200)).toContain("import.meta.env.DEV");
	});
});

describe("worker URLs", () => {
	it("every path hangs off the chosen host, and none exists without one", () => {
		setWorkerTarget("worker-cloud-prod");
		expect([tileUrl(10, 1, 2), satelliteTileUrl("usgs", 16, 3, 4), squirrelUrl(), squirrelUrl("/forget/usgs"), whereUrl(), hospitalsUrl(-119.5, 49.2, 50)]).toEqual([
			`${TEST_HOST}/10/1/2.pbf`,
			`${TEST_HOST}/satellite/usgs/16/3/4.jpg`,
			`${TEST_HOST}/squirrel`,
			`${TEST_HOST}/squirrel/forget/usgs`,
			`${TEST_HOST}/where`,
			`${TEST_HOST}/hospitals?lng=-119.5&lat=49.2&km=50`,
		]);
		configureTilesHost("");
		expect([tileUrl(1, 1, 1), satelliteTileUrl("usgs", 1, 1, 1), squirrelUrl(), whereUrl(), hospitalsUrl(0, 0, 1)]).toEqual([null, null, null, null, null]);
	});

	it("a shipped build is locked to production whatever the tab stored, and a switch cannot be written", () => {
		vi.stubEnv("DEV", false);
		try {
			sessionStorage.setItem("rt_worker_target", "worker-local-dev");
			expect(getWorkerTarget()).toBe("worker-cloud-prod");
			sessionStorage.clear();
			setWorkerTarget("worker-local-dev");
			expect(sessionStorage.getItem("rt_worker_target")).toBeNull();
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe("the big-download check", () => {
	it("the web counts anything but cellular as Wi-Fi, until the native app says for itself", async () => {
		const nav = navigator as { connection?: { type?: string } };
		const was = Object.getOwnPropertyDescriptor(navigator, "connection");
		Object.defineProperty(navigator, "connection", { value: { type: "cellular" }, configurable: true });
		try {
			expect(await onWifi()).toBe(false);
			nav.connection!.type = "wifi";
			expect(await onWifi()).toBe(true);
			configureWifiCheck(async () => false);
			expect(await onWifi()).toBe(false);
		} finally {
			if (was) Object.defineProperty(navigator, "connection", was);
			else delete nav.connection;
		}
	});
});

describe("probeTarget", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("any answer, even a 4xx, is up", async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 404 }));
		vi.stubGlobal("fetch", fetch);
		expect(await probeTarget("worker-local-dev")).toBe(true);
		expect(fetch).toHaveBeenCalledWith(`${LOCAL_DEV_HOST}/`, expect.objectContaining({ method: "OPTIONS", mode: "cors" }));
		expect(probeOf("worker-local-dev")).toBe(true);
	});

	it("a target with no host is down without asking anyone", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		configureTilesHost("");
		expect(await probeTarget("worker-cloud-prod")).toBe(false);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("a host that never answers is given up on at the timeout", async () => {
		vi.stubGlobal("fetch", (_: string, init: RequestInit) => new Promise((_, no) => init.signal!.addEventListener("abort", () => no(new Error("aborted")))));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await probeTarget("worker-cloud-prod", 5)).toBe(false);
		expect(probeOf("worker-cloud-prod")).toBe(false);
		warn.mockRestore();
	});

	it("says once per reason why a probe failed, and names DNS when the name did not resolve", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		configureTilesHost("https://probe-once.example.test");
		vi.stubGlobal("fetch", async () => {
			throw new TypeError("net::ERR_NAME_NOT_RESOLVED");
		});
		expect(await probeTarget("worker-cloud-prod")).toBe(false);
		expect(await probeTarget("worker-cloud-prod")).toBe(false);
		vi.stubGlobal("fetch", async () => {
			throw "refused";
		});
		await probeTarget("worker-cloud-prod");
		expect(warn.mock.calls.map(([m]) => String(m))).toEqual([
			expect.stringMatching(/ERR_NAME_NOT_RESOLVED — this is DNS[\s\S]*dig \+short probe-once\.example\.test/),
			expect.stringMatching(/refused — something answered the name but not the request/),
		]);
		warn.mockRestore();
	});
});

function readSource(): string {
	return readFileSync(
		fileURLToPath(new URL("./tilesHost.ts", import.meta.url)),
		"utf8",
	);
}
