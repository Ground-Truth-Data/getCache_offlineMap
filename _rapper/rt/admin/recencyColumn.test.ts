import { describe, expect, it } from "vitest";
import { recencyColumn } from "./recencyColumn";

// Only the two answers that would be WRONG on screen are pinned. The rest of
// the preference order is a convenience, and a test over it would freeze a
// judgement call that should stay cheap to change.
describe("recencyColumn", () => {
	// `retiredAt`/`trashedAt` are empty for every LIVE row, so sorting by one
	// buries the rows the browser was opened to see under the dead ones.
	it("never picks a lifecycle stamp over a real edit time", () => {
		expect(recencyColumn(["retiredAt", "trashedAt", "createdAt"])).toBe(
			"createdAt",
		);
	});

	// "" is the component's unsorted marker: a table with no notion of recency
	// keeps its natural order rather than being sorted by the wrong column.
	it("returns the unsorted marker when the table has no time at all", () => {
		expect(recencyColumn(["cacheKey", "boxTag"])).toBe("");
	});
});
