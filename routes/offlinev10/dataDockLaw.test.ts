/**
 * THE METER LAW. `startDataMeter` counts the entries already in the buffer the
 * moment it is called, so calling it from inside an `$effect` writes reactive
 * state that the same component reads — `effect_update_depth_exceeded`, an
 * error boundary, and a black page. Only /app/offlinev10/debug mounts DataDock,
 * which is why the plain map survived it.
 *
 * Read as source, because the bug is WHERE the call sits, not what it returns.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const DOCK = read("./DataDock.svelte");

describe("THE METER LAW", () => {
	it("never starts the meter from inside an $effect", () => {
		// `$effect(() => startDataMeter())` — the exact shape that looped.
		expect(DOCK).not.toMatch(/\$effect\s*\(\s*\(\s*\)\s*=>\s*startDataMeter/);
	});

	it("starts it on mount instead, so the count lands outside the read path", () => {
		expect(DOCK).toMatch(/onMount/);
		expect(DOCK).toMatch(/startDataMeter/);
	});

	it("stops the meter when the dock goes, so a remount does not stack observers", () => {
		// onMount's return is the teardown; without it a second visit leaks.
		expect(DOCK).toMatch(/onMount\s*\(\s*\(\s*\)\s*=>\s*startDataMeter\s*\(\s*\)\s*\)/);
	});
});
