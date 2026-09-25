/** ⚠️ Sign-out's scope, from both sides: a store misclassified as impersonal leaks the previous user's data to the next person at the browser; one misclassified as personal costs a multi-gigabyte re-download. */
import { describe, expect, it } from "vitest";
import {
	APP_DB,
	FIRE_DB,
	isPersonalDb,
	LEGACY_VECTORS_DB_NAME,
	REGISTRY_DB,
	SAT_DB,
	V4_TILES_DB,
} from "./dbCatalog";
import { SANDBOX_SUFFIX } from "../../shared/sandboxDbNames";

describe("isPersonalDb", () => {
	it("keeps imagery a re-download would restore", () => {
		for (const db of [V4_TILES_DB, SAT_DB]) {
			expect(isPersonalDb(db), db).toBe(false);
		}
	});

	it("destroys the stores that describe the person who was signed in", () => {
		// The registry names the areas they baked and the fire cache the ground
		// they were watching — both reveal where someone works.
		for (const db of [APP_DB, REGISTRY_DB, FIRE_DB, LEGACY_VECTORS_DB_NAME]) {
			expect(isPersonalDb(db), db).toBe(true);
		}
	});

	it("classifies a sandbox twin like its base — real edits land there too", () => {
		expect(isPersonalDb(APP_DB + SANDBOX_SUFFIX)).toBe(true);
		expect(isPersonalDb(V4_TILES_DB + SANDBOX_SUFFIX)).toBe(false);
	});

	it("treats an unrecognised database as personal", () => {
		// A store added later is wiped until someone deliberately exempts it:
		// forgetting costs a re-download, the other default leaks data.
		expect(isPersonalDb("gc-somethingNewNobodyRegistered")).toBe(true);
	});
});
