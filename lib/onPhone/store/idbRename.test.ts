/** A helper that only means to LOOK at a database must never create one: `indexedDB.open(name)` with no version makes an empty, store-less shell when the name is absent, and the app's own persister then trips over the shell on every load. */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { cloneEntireIdbDatabase, renameQaTablesInIdb } from "./idbRename";

const factory = indexedDB as IDBFactory & {
    databases?: IDBFactory["databases"];
};
const listDatabases = factory.databases?.bind(factory);

afterEach(() => {
    factory.databases = listDatabases;
});

async function names(): Promise<string[]> {
    return (await listDatabases?.())?.map((d) => d.name ?? "") ?? [];
}

describe("idbRename never creates", () => {
    it("a browser without indexedDB.databases() gets the probe, and the probe leaves nothing behind", async () => {
        // Without the enumeration API the existence guard is bypassed by design, so the open itself must be the wall.
        factory.databases = undefined;
        await renameQaTablesInIdb("rt-ghost", [{ from: "a", to: "b" }]);
        await cloneEntireIdbDatabase("rt-ghost-old", "rt-ghost-new");
        factory.databases = listDatabases;
        const after = await names();
        expect(after).not.toContain("rt-ghost");
        expect(after).not.toContain("rt-ghost-old");
        expect(after).not.toContain("rt-ghost-new");
    });
});

function openWithT(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 2);
        req.onupgradeneeded = () => {
            for (const os of ["t", "v"]) {
                if (!req.result.objectStoreNames.contains(os)) {
                    req.result.createObjectStore(os, { keyPath: "k" });
                }
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (os: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = run(db.transaction("t", mode).objectStore("t"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

describe("idbRename same-table cell rename", () => {
    it("rewrites the cell in place, maps the sentinel, and never deletes the table", async () => {
        const db = await openWithT("rt-cell-rename");
        await tx(db, "readwrite", (os) =>
            os.put({
                k: "mapFeatureTable",
                v: {
                    r1: { name: "drawn", isRetreever: "isRetreever" },
                    r2: { name: "foreign", isRetreever: "" },
                    r3: { name: "already", madeWith: "GetCache.org" },
                },
            }),
        );
        db.close();
        await renameQaTablesInIdb("rt-cell-rename", [
            {
                from: "mapFeatureTable",
                to: "mapFeatureTable",
                cell: {
                    from: "isRetreever",
                    to: "madeWith",
                    value: { from: "isRetreever", to: "GetCache.org" },
                },
            },
        ]);
        const db2 = await openWithT("rt-cell-rename");
        const rec = (await tx(db2, "readonly", (os) => os.get("mapFeatureTable"))) as {
            v: Record<string, Record<string, unknown>>;
        };
        db2.close();
        expect(rec.v.r1).toEqual({ name: "drawn", madeWith: "GetCache.org" });
        expect(rec.v.r2).toEqual({ name: "foreign", madeWith: "" });
        expect(rec.v.r3).toEqual({ name: "already", madeWith: "GetCache.org" });
    });
});
