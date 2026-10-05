import { describe, expect, it } from "vitest";
import { expectationOf, healthOf, tableEmpty } from "./schemaBands";

describe("expectationOf", () => {
	// Off means "I know about this one", not "this is fine".
	it("drops a switched-off key attribute to normal", () => {
		expect(expectationOf("LandTable", "landName", new Set())).toBe("normal");
	});

	it("lets a key attribute be named on an audit column", () => {
		const keys = new Set(["CropTable.authorKey"]);
		expect(expectationOf("CropTable", "authorKey", keys)).toBe("key");
	});
});

describe("healthOf", () => {
	/** No "mostly empty" band: it made 2% filled look calmer than 0%. */
	it("bands a key attribute by how empty it is", () => {
		expect(healthOf(0, "key").band).toBe("empty-key");
		expect(healthOf(0.6, "key").band).toBe("partial-key");
		expect(healthOf(1, "key").band).toBe("full");
	});

	// Any amount above nothing is "some of it filled" — no threshold between.
	it("calls a barely-filled column partial, never a shade of empty", () => {
		expect(healthOf(0.01, "key").band).toBe("partial-key");
		expect(healthOf(0.1, "normal").band).toBe("partial");
		expect(healthOf(0.24, "normal").band).toBe("partial");
	});

	it("mutes the same shape for an ordinary column", () => {
		expect(healthOf(0, "normal").band).toBe("empty");
		expect(healthOf(1, "normal").band).toBe("full");
	});

	// 99% of 40,000 rows is 400 missing values.
	it("does not round a nearly-full column up to populated", () => {
		expect(healthOf(0.98, "key").band).toBe("partial-key");
	});
});

describe("tableEmpty", () => {
	/** The card answers only whether the table is empty; its rows say the rest. */
	it("flags an empty table however the rest of the platform looks", () => {
		expect(tableEmpty(0)).toBe(true);
	});

	it("says nothing about a table that has rows", () => {
		expect(tableEmpty(12)).toBe(false);
	});
});
