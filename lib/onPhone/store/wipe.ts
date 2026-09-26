/** Databases the wipe destroys. Tiles + bookkeeping only — never user data. */
export const WIPE_DBS = [
	"gc-offlineTiles",
	"gc-offlineSatellite",
	"rt-vectors",
	"rt-mapRegistry",
] as const;

/** Never add these to WIPE_DBS: the user's own data lives here. */
export const NEVER_WIPE = ["rt-treeStuff"] as const;

/** Still written to. A wipe the user asked for may take them; the unasked boot-time retirement sweep may not, since nothing refills what it takes. */
export const V10_LIVE_DBS = [
	"gc-offlineSatellite",
	"rt-mapRegistry",
] as const;

export interface WipeResult {
	readonly deleted: Record<string, "gone" | "blocked" | "absent">;
	readonly clean: boolean;
}

function deleteDb(name: string): Promise<"gone" | "blocked"> {
	return new Promise((resolve) => {
		const req = indexedDB.deleteDatabase(name);
		req.onsuccess = () => resolve("gone");
		req.onerror = () => resolve("blocked");
		// onblocked means queued behind an open connection; onsuccess still fires once it closes.
		req.onblocked = () => {
			setTimeout(() => resolve("blocked"), BLOCKED_GRACE_MS);
		};
	});
}

const BLOCKED_GRACE_MS = 3000;

export async function wipeOfflineData(
	names: readonly string[] = WIPE_DBS,
): Promise<WipeResult> {
	console.warn("[wipe] ── starting ──");
	const existing = new Set<string>();
	// `databases()` is not in older Safari; absent means try them all.
	if (typeof indexedDB.databases === "function") {
		try {
			for (const d of await indexedDB.databases()) {
				if (d.name) existing.add(d.name);
			}
		} catch {
			/* attempt every name */
		}
	}

	const deleted: Record<string, "gone" | "blocked" | "absent"> = {};
	for (const name of names) {
		if (existing.size > 0 && !existing.has(name)) {
			deleted[name] = "absent";
			continue;
		}
		// A versionless open creates the DB when absent, so count only what the catalogue proved is there.
		if (name === "gc-offlineTiles" && existing.has(name)) {
			try {
				console.warn(`[wipe] tiles on disk before: ${await countTiles()}`);
			} catch {
				/* diagnostic only */
			}
		}
		console.warn(`[wipe] deleting ${name}…`);
		deleted[name] = await deleteDb(name);
		console.warn(`[wipe]   ${name}: ${deleted[name]}`);
	}

	const clean = Object.values(deleted).every((v) => v !== "blocked");
	console.warn(
		clean
			? `[wipe] ✅ CLEAN — ${names.join(", ")} gone.`
			: `[wipe] ❌ BLOCKED — ${names.join(", ")} still held. Close other tabs on this origin.`,
		deleted,
	);
	return { deleted, clean };
}

function countTiles(): Promise<number> {
	return new Promise((resolve) => {
		const req = indexedDB.open("gc-offlineTiles");
		req.onsuccess = () => {
			const db = req.result;
			if (![...db.objectStoreNames].includes("tiles")) {
				db.close();
				resolve(0);
				return;
			}
			// An aborted transaction leaves `count` silent.
			const tx = db.transaction("tiles", "readonly");
			const c = tx.objectStore("tiles").count();
			tx.oncomplete = () => {
				resolve(c.result);
				db.close();
			};
			const failed = () => {
				resolve(-1);
				db.close();
			};
			tx.onabort = failed;
			tx.onerror = failed;
		};
		req.onerror = () => resolve(-1);
		req.onblocked = () => resolve(-1);
	});
}
