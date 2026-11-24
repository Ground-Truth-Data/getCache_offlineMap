// @vitest-environment happy-dom
// The credits stand on the shovel's blade only while their map lives: a shovel on a page with no map (bags) shows none.
import { describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({
	AttributionControl: class {
		_container?: HTMLElement;
		onAdd() {
			this._container = document.createElement("details");
			this._container.textContent = "© MapTiler";
			return this._container;
		}
		onRemove() {
			this._container?.remove();
		}
	},
}));

import { creditsControl, shovelCredits } from "./photoCredits";

describe("the map's credits on the shovel", () => {
	it("leave with their map, so the next page's shovel stands bare", async () => {
		const made = creditsControl();
		const onMap = document.createElement("div");
		const drop = shovelCredits(onMap);
		made.onAdd({} as never);
		await Promise.resolve();
		expect(onMap.textContent, "on the map's own page").toBe("© MapTiler");

		made.onRemove();
		drop();
		const onBags = document.createElement("div");
		shovelCredits(onBags);
		expect(onBags.textContent).toBe("");
	});
});
