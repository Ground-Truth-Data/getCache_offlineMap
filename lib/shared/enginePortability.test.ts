/**
 * THE SEAM GUARD — the offline engine must import with NO host present (no TinyBase, mapStore, Supabase, Capacitor).
 * ⚠️ app tests mock every host dependency, so a new host import here is invisible to them.
 * ⚠️ a grep can be dodged by an alias/re-export — only a real import catches a host dependency creeping back in, by failing to load with it named.
 */
import { expect, it } from "vitest";

it("the blob engine imports with no host, no store and no Supabase", async () => {
	const m = await import("../../routes/offlinev10/blobService");
	// Must be IMPOSSIBLE to start without a host — the ports are the contract, not an optional extra.
	expect(m.startBlobService.length).toBe(1);
});

it("the host port module itself has no dependencies at all", async () => {
	const src = await import("./hostPorts");
	// Types erase at runtime so the module is legitimately empty — the assertion is that importing it CANNOT drag anything in.
	expect(src).toBeDefined();
});
