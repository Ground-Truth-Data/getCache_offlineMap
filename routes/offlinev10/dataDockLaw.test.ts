/**
 * `startDataMeter` writes reactive state the dock reads, so from inside an `$effect` it loops
 * and takes the page down. Read as source, because the bug is WHERE the call sits.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const DOCK = read("./DataDock.svelte");

describe("THE METER LAW", () => {
	it("never starts the meter from inside an $effect", () => {
		expect(DOCK).not.toMatch(/\$effect\s*\(\s*\(\s*\)\s*=>\s*startDataMeter/);
	});

	it("starts it on mount instead, so the count lands outside the read path", () => {
		expect(DOCK).toMatch(/onMount/);
		expect(DOCK).toMatch(/startDataMeter/);
	});

	it("stops the meter when the dock goes, so a remount does not stack observers", () => {
		expect(DOCK).toMatch(/onMount\s*\(\s*\(\s*\)\s*=>\s*startDataMeter\s*\(\s*\)\s*\)/);
	});
});
