// Regression guard: the waiting box must watch the source of the overlay that is
// actually mounting. Watching the bare id while a SECOND sheet mounts left the box
// on screen — the bare source belongs to overlay 0 and is already loaded, so no
// further sourcedata ever fires for it.

import { describe, expect, it } from "vitest";
import { imageSourceId } from "./mobMapOverlay";

describe("imageSourceId", () => {
	it("gives the FIRST overlay the bare id — the swap path depends on it", () => {
		expect(imageSourceId(undefined)).toBe("map-overlay-image");
	});

	it("gives a later overlay its OWN id — the bug was watching the bare one", () => {
		expect(imageSourceId("featb")).not.toBe(imageSourceId(undefined));
	});

	it("keeps distinct slots distinct", () => {
		expect(imageSourceId("feata")).not.toBe(imageSourceId("featb"));
	});
});
