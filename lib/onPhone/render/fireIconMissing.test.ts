/**
 * The flame is decoded once before the layers exist, so every registration
 * after — including the missing-image resolver's — is a synchronous addImage.
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

	it("re-registers through the missing-image resolver, for its own id only", () => {
		const at = raw.indexOf("setMissingStyleImageResolver((id)");
		const resolver = raw.slice(at, at + 200);
		expect(at).toBeGreaterThan(-1);
		expect(resolver).toMatch(/id === FIRE_ICON\) ensureFireIcon\(map\)/);
	});

	it("unbinds on dispose", () => {
		expect(raw).toContain("setMissingStyleImageResolver(null)");
	});
});
