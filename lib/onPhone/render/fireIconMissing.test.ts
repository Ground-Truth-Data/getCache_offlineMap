/**
 * MapLibre fires `styleimagemissing` and warns in the SAME tick unless a
 * listener already called `addImage` — an async `loadImage` always loses that
 * race, so the flame must be decoded once before the layers exist, and every
 * registration after must be synchronous.
 *
 * Source-text scan: this module reaches bundler-only asset imports and cannot
 * be imported under vitest.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
	fileURLToPath(new URL("./fireLayer.ts", import.meta.url)),
	"utf8",
);

const body = (start: string): string => {
	const fn = raw.slice(raw.indexOf(start));
	return fn.slice(0, fn.indexOf("\n}"));
};

describe("the flame registers synchronously", () => {
	it("never loads the flame through the renderer's async loadImage", () => {
		expect(raw).not.toContain("loadImage(");
	});

	it("registers from an already-decoded image, with no await", () => {
		const fn = body("function ensureFireIcon");
		expect(fn).toMatch(/map\.addImage\(FIRE_ICON,/);
		expect(fn).not.toMatch(/\bawait\b|\.then\(/);
	});

	it("waits for the decoded flame before adding the layers", () => {
		const fn = raw.slice(raw.indexOf("const paint = async"));
		const waitAt = fn.indexOf("await flameDecoded");
		const addAt = fn.indexOf("addFireLayers(map");
		expect(waitAt).toBeGreaterThan(-1);
		expect(addAt).toBeGreaterThan(waitAt);
	});

	it("re-registers inside styleimagemissing, for its own id only", () => {
		const at = raw.indexOf('"styleimagemissing"');
		const handler = raw.slice(at - 200, at);
		expect(handler).toMatch(/e\.id === FIRE_ICON\) ensureFireIcon\(map\)/);
	});

	it("unbinds on dispose", () => {
		expect(raw).toMatch(/map\.off\(\s*"styleimagemissing"/);
	});
});
