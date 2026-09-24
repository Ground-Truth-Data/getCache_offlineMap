import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
	configureTilesDevHost,
	configureTilesHost,
	DEFAULT_TARGET,
	firesUrl,
	getWorkerTarget,
	LOCAL_DEV_HOST,
	packUrl,
	setWorkerTarget,
	tilesHost,
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
		expect(packUrl()).toBe(`${LOCAL_DEV_HOST}/pack`);
		expect(firesUrl()).toBe(`${LOCAL_DEV_HOST}/fires`);

		setWorkerTarget("worker-cloud-prod");
		expect(packUrl()).toBe(`${TEST_HOST}/pack`);
		expect(firesUrl()).toBe(`${TEST_HOST}/fires`);
	});

	it("URLs are read per call, so a switch takes effect without a reload", () => {
		setWorkerTarget("worker-cloud-prod");
		const before = packUrl();
		setWorkerTarget("worker-local-dev");
		expect(packUrl()).not.toBe(before);
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

function readSource(): string {
	return readFileSync(
		fileURLToPath(new URL("./tilesHost.ts", import.meta.url)),
		"utf8",
	);
}
