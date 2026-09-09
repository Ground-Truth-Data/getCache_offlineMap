import { describe, expect, it } from "vitest";
import { blobBytes } from "./budget";

describe("a blob's size on disk", () => {
	it("counts the photo, not the roads alone", () => {
		// Rainbow Lake as the dock showed it: 3.0 MB of tiles, 1.1 MB of
		// photo, and a header that read 3.0 MB.
		expect(blobBytes(3_145_728, 1_153_434)).toBe(4_299_162);
	});

	it("a corridor has no photo to add", () => {
		expect(blobBytes(3_145_728)).toBe(3_145_728);
		expect(blobBytes(3_145_728, undefined)).toBe(3_145_728);
	});
});
