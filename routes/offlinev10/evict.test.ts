import { describe, expect, it } from "vitest";
import { BLOB_COUNT_CAP } from "./budget";
import { type Evictable, toEvict } from "./evict";

/** The store passes the real figure; here the fixtures are the whole disk. */
const sum = (rs: readonly Evictable[]) => rs.reduce((a, r) => a + r.bytes, 0);

const blob = (id: string, at: number, bytes = 10): Evictable => ({
	id,
	at,
	bytes,
});

describe("toEvict — oldest wins the axe", () => {
	it("takes nothing when both walls have room", () => {
		const have = [blob("a", 1), blob("b", 2)];
		expect(toEvict(have, { used: sum(have), adding: 10, budget: 1000, cap: 10 })).toEqual([]);
	});

	it("takes the oldest first, and only as many as the size wall needs", () => {
		const have = [blob("new", 300), blob("old", 100), blob("mid", 200)];
		// 30 on disk, budget 35, adding 10 — one blob (10 bytes) makes room.
		const out = toEvict(have, { used: sum(have), adding: 10, budget: 35, cap: 99 });
		expect(out.map((r) => r.id)).toEqual(["old"]);
	});

	it("keeps taking until the new blob actually fits", () => {
		const have = [blob("old", 100), blob("mid", 200), blob("new", 300)];
		// 30 on disk, budget 30, adding 15 — needs 15 freed, so two must go.
		const out = toEvict(have, { used: sum(have), adding: 15, budget: 30, cap: 99 });
		expect(out.map((r) => r.id)).toEqual(["old", "mid"]);
	});

	it("evicts on the COUNT wall even when bytes are tiny", () => {
		const have = [blob("a", 1, 1), blob("b", 2, 1), blob("c", 3, 1)];
		// Three on disk, cap of 3, one more coming: the oldest goes.
		const out = toEvict(have, { used: sum(have), adding: 1, budget: 1e9, cap: 3 });
		expect(out.map((r) => r.id)).toEqual(["a"]);
	});

	it("frees enough for BOTH walls at once", () => {
		const have = [blob("a", 1, 50), blob("b", 2, 1), blob("c", 3, 1)];
		// Count says one must go; bytes say 50 must be freed. "a" answers both.
		const out = toEvict(have, { used: sum(have), adding: 40, budget: 60, cap: 3 });
		expect(out.map((r) => r.id)).toEqual(["a"]);
	});

	it("never proposes evicting everything to fit an impossible blob", () => {
		const have = [blob("a", 1, 10), blob("b", 2, 10)];
		// Asking for more than the whole budget: refuse, do not strip the disk.
		expect(toEvict(have, { used: sum(have), adding: 5000, budget: 100, cap: 10 })).toEqual([]);
	});

	it("is stable on equal timestamps rather than order-dependent", () => {
		const have = [blob("b", 100), blob("a", 100)];
		// 20 on disk, budget 25, adding 10 — one of the two must go, either.
		const out = toEvict(have, { used: sum(have), adding: 10, budget: 25, cap: 99 });
		expect(out).toHaveLength(1);
		expect(["a", "b"]).toContain(out[0].id);
	});

	it("never strips the disk chasing bytes that unsized rows cannot free", () => {
		// Mid-download rows read `bytes: 0`. Evicting them frees nothing the
		// policy can count, so a loop that took them would walk the whole disk
		// and still not fit. It must stop instead and let the write be refused.
		const have = [blob("a", 1, 0), blob("b", 2, 0), blob("c", 3, 0)];
		const out = toEvict(have, { used: 900, adding: 50, budget: 1000, cap: 99 });
		expect(out).toEqual([]);
	});

	it("still honours the count wall when rows are unsized", () => {
		const have = [blob("a", 1, 0), blob("b", 2, 0), blob("c", 3, 0)];
		const out = toEvict(have, { used: 0, adding: 0, budget: 1e9, cap: 3 });
		expect(out.map((r) => r.id)).toEqual(["a"]);
	});

	it("ships a count cap, so 440 pins cannot mean 440 blobs", () => {
		expect(BLOB_COUNT_CAP).toBe(1000);
	});
});
