import { describe, expect, it } from "vitest";
import {
	currentDbName,
	sandboxWorld,
	setSandboxStorageActive,
	worldSuffix,
} from "./sandboxDbNames";

describe("named worlds — ?sandbox=<world>", () => {
	it("reads the world off a search string", () => {
		expect(sandboxWorld("")).toBeNull();
		expect(sandboxWorld("?sandbox=0")).toBeNull();
		expect(sandboxWorld("?sandbox=")).toBeNull();
		expect(sandboxWorld("?sandbox=1")).toBe("1");
		expect(sandboxWorld("?sandbox=blue&insist=0")).toBe("blue");
	});

	it("refuses a token that is not safe in a DB name", () => {
		expect(sandboxWorld("?sandbox=a/b")).toBeNull();
		expect(sandboxWorld("?sandbox=" + "x".repeat(40))).toBeNull();
	});

	it("keeps the practice sandbox's suffix and derives a named world's from it", () => {
		expect(worldSuffix("1")).toBe("-sandbox");
		expect(worldSuffix("blue")).toBe("-sandbox-blue");
	});

	it("suffixes every DB name by the active world, and none in the real app", () => {
		setSandboxStorageActive(true, "green");
		expect(currentDbName("rt-treeStuff")).toBe("rt-treeStuff-sandbox-green");
		setSandboxStorageActive(true);
		expect(currentDbName("rt-treeStuff")).toBe("rt-treeStuff-sandbox");
		setSandboxStorageActive(false);
		expect(currentDbName("rt-treeStuff")).toBe("rt-treeStuff");
	});
});
