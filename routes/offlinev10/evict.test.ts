import { describe, expect, it } from "vitest";
import { BLOB_COUNT_CAP } from "./budget";
import { type Evictable, toEvict } from "./evict";

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
		const out = toEvict(have, { used: sum(have), adding: 10, budget: 35, cap: 99 });
		expect(out.map((r) => r.id)).toEqual(["old"]);
	});

	it("keeps taking until the new blob actually fits", () => {
		const have = [blob("old", 100), blob("mid", 200), blob("new", 300)];
		const out = toEvict(have, { used: sum(have), adding: 15, budget: 30, cap: 99 });
		expect(out.map((r) => r.id)).toEqual(["old", "mid"]);
	});

	it("evicts on the COUNT wall even when bytes are tiny", () => {
		const have = [blob("a", 1, 1), blob("b", 2, 1), blob("c", 3, 1)];
		const out = toEvict(have, { used: sum(have), adding: 1, budget: 1e9, cap: 3 });
		expect(out.map((r) => r.id)).toEqual(["a"]);
	});

	it("frees enough for BOTH walls at once", () => {
		const have = [blob("a", 1, 50), blob("b", 2, 1), blob("c", 3, 1)];
		const out = toEvict(have, { used: sum(have), adding: 40, budget: 60, cap: 3 });
		expect(out.map((r) => r.id)).toEqual(["a"]);
	});

	it("never proposes evicting everything to fit an impossible blob", () => {
		const have = [blob("a", 1, 10), blob("b", 2, 10)];
		expect(toEvict(have, { used: sum(have), adding: 5000, budget: 100, cap: 10 })).toEqual([]);
	});

	it("is stable on equal timestamps rather than order-dependent", () => {
		const have = [blob("b", 100), blob("a", 100)];
		const out = toEvict(have, { used: sum(have), adding: 10, budget: 25, cap: 99 });
		expect(out).toHaveLength(1);
		expect(["a", "b"]).toContain(out[0].id);
	});

	it("never strips the disk chasing bytes that unsized rows cannot free", () => {
		// Mid-download rows read `bytes: 0`.
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
