// One object store under explicit string keys: what is put comes back, keys
// and values list, a projection streams, and a database that lost its store
// is dropped and recreated on first open instead of failing forever.
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyedIdbStore } from "./keyedIdbStore";

beforeEach(() => {
	vi.stubGlobal("indexedDB", new IDBFactory());
	return () => vi.unstubAllGlobals();
});

describe("makeKeyedIdbStore", () => {
	it("puts, gets, lists, projects and deletes by key", async () => {
		const s = makeKeyedIdbStore<{ n: number; big: string }>({ dbName: "t-boxes", storeName: "boxes" });
		expect(await s.get("a")).toBeUndefined();
		await s.put("a", { n: 1, big: "x".repeat(10) });
		await s.put("b", { n: 2, big: "y" });
		expect(await s.get("a")).toEqual({ n: 1, big: "xxxxxxxxxx" });
		expect(await s.keys()).toEqual(["a", "b"]);
		expect((await s.getAll()).map((v) => v.n)).toEqual([1, 2]);
		expect(await s.getAllProjected((v) => v.n * 10)).toEqual([10, 20]);
		await s.delete("a");
		expect(await s.keys()).toEqual(["b"]);
	});

	it("heals a database that exists without its store", async () => {
		await new Promise<void>((res) => {
			const req = indexedDB.open("t-shell", 1);
			req.onupgradeneeded = () => req.result.createObjectStore("other");
			req.onsuccess = () => (req.result.close(), res());
		});
		const s = makeKeyedIdbStore<string>({ dbName: "t-shell", storeName: "boxes" });
		await s.put("k", "v");
		expect(await s.get("k")).toBe("v");
		const names = await new Promise<string[]>((res) => {
			const req = indexedDB.open("t-shell");
			req.onsuccess = () => (res([...req.result.objectStoreNames]), req.result.close());
		});
		expect(names).toEqual(["boxes"]);
	});

	it("rejects when the transaction aborts", async () => {
		const s = makeKeyedIdbStore<unknown>({ dbName: "t-abort", storeName: "boxes" });
		await expect(s.put("k", () => "a function cannot be cloned")).rejects.toThrow();
	});
});
