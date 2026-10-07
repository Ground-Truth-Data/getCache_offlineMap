import { describe, expect, it } from "vitest";
import type { MapHostFeature } from "../shared/mapHostPorts";
import { resolveFeatureBounds } from "./mapFraming";

describe("resolveFeatureBounds", () => {
	// The store hands every row over as a Feature; a PDF's has a null geometry.
	it("frames a PDF overlay by its bounds", async () => {
		const pdf = {
			mapFeatureKey: "ftr-1",
			featureType: "overlay",
			geometry: { type: "Feature", geometry: null, properties: {} },
			overlayStorageKey: "a.webp",
			overlayBounds: [-119.1, 50.23, -119.03, 50.3],
		} as unknown as MapHostFeature;
		expect(await resolveFeatureBounds(pdf)).toEqual({ minLng: -119.1, minLat: 50.23, maxLng: -119.03, maxLat: 50.3 });
	});
});
