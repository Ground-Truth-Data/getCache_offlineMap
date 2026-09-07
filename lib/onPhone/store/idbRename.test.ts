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
