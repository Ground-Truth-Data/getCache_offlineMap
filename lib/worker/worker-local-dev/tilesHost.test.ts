// the worker switch must be UNSHIPPABLE — import.meta.env.DEV makes the override dead code in a production build, since a runtime toggle could ship silently pointed at a dev Worker.
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

/** TEST_HOST stands in for the removed production-host constant (see tilesHost.ts); a .test domain ensures a copied test can never hit a real request. */
const TEST_HOST = "https://tiles.example.test";

beforeEach(() => {
	sessionStorage.clear();
	// module state — re-established per test; see tilesHost.ts for why the host is module-level, not a parameter.
	configureTilesHost(TEST_HOST);
});

describe("worker target", () => {
	it("follows its own tier's default, with no stored override", () => {
		// the always-up cloud dev worker is the starting tier (Chris, 7 Sep 2026):
		// it runs prod's code on prod's bucket, so an experiment cannot reach a
		// shipped build, and it does not die with a closed terminal. A SHIPPED
		// build never reads DEFAULT_TARGET — the !DEV early return in
		// getWorkerTarget() locks phones to production, and the gating test
		// below is what protects that.
		// ⚠️ Asserted against DEFAULT_TARGET, not a literal: this file is shared
		// byte-for-byte by all three tiers, and each names a different default.
		expect(getWorkerTarget()).toBe(DEFAULT_TARGET);
		// tilesHost() reads the slot the tier's own default names — the prod
		// slot is the one beforeEach fills, the dev slot starts empty.
		const prodTier = DEFAULT_TARGET === "worker-cloud-prod";
		expect(tilesHost()).toBe(prodTier ? TEST_HOST : null);
		configureTilesDevHost("https://tiles-dev.example.test");
		expect(tilesHost()).toBe(
			prodTier ? TEST_HOST : "https://tiles-dev.example.test",
		);
	});

	it("switches every URL together — no split-brain", () => {
		// The failure this prevents: roads from one target, fires from another.
		setWorkerTarget("worker-local-dev");
		expect(tilesHost()).toBe(LOCAL_DEV_HOST);
		expect(packUrl()).toBe(`${LOCAL_DEV_HOST}/pack`);
		expect(firesUrl()).toBe(`${LOCAL_DEV_HOST}/fires`);

		setWorkerTarget("worker-cloud-prod");
		expect(packUrl()).toBe(`${TEST_HOST}/pack`);
		expect(firesUrl()).toBe(`${TEST_HOST}/fires`);
	});

	it("URLs are read per call, so a switch takes effect without a reload", () => {
		// a const cannot see a later choice — the toggle would look inert, and you'd end up testing production while believing you're on local.
		setWorkerTarget("worker-cloud-prod");
		const before = packUrl();
		setWorkerTarget("worker-local-dev");
		expect(packUrl()).not.toBe(before);
	});

	it("ignores a corrupt or hostile stored value", () => {
		sessionStorage.setItem("rt_worker_target", "https://evil.example.com");
		expect(getWorkerTarget()).toBe(DEFAULT_TARGET);
		// a stored origin is never a host — the default tier's own host answers, or null
		expect(tilesHost()).not.toBe("https://evil.example.com");
	});

	it("the override is gated on import.meta.env.DEV in BOTH directions", () => {
		// if either the reader or writer loses its DEV guard, a production build becomes switchable and the shipped app can point at a dev Worker.
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
