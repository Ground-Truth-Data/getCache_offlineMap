/**
 * The flame icon survives a style swap.
 *
 * `rt-fire-flame` is registered by `ensureFireIcon` through an ASYNC
 * `loadImage`, while the symbol layer that asks for it is added synchronously.
 * A `setStyle` landing between the load and the resolve wipes the image
 * registry, and `addFireLayers` then short-circuits on `getSource(...)` — so
 * the layer exists, the image does not, and MapLibre logs
 * `Image "rt-fire-flame" could not be loaded` forever after.
 *
 * `style.load` alone does not cover it: the wipe can land after that fires.
 * The renderer's own `styleimagemissing` is the only signal that reports the
 * image is actually absent, so the layer must listen for it and re-register.
 *
 * Source-text scan, matching the sibling fireLayer.test.ts: this module reaches
 * bundler-only asset imports and cannot be imported under vitest.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
	fileURLToPath(new URL("./fireLayer.ts", import.meta.url)),
	"utf8",
);

describe("the flame icon re-registers when the style drops it", () => {
	it("listens for styleimagemissing", () => {
		expect(raw).toMatch(/map\.on\(\s*"styleimagemissing"/);
	});

	it("re-registers the flame rather than only repainting", () => {
		// The handler must reach ensureFireIcon: `paint()` alone re-adds layers
		// but bails at the source check, leaving the image unregistered.
		const handler = raw.slice(
			raw.indexOf("styleimagemissing") - 400,
			raw.indexOf("styleimagemissing") + 200,
		);
		expect(handler).toContain("ensureFireIcon");
	});

	it("only answers for its own image id", () => {
		// A blanket re-register would fight every other layer's missing images.
		expect(raw).toMatch(/e\.id === FIRE_ICON/);
	});

	it("unbinds on dispose", () => {
		expect(raw).toMatch(/map\.off\(\s*"styleimagemissing"/);
	});
});
