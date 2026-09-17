/**
 * Every IndexedDB helper in this folder is awaited by boot, so one of them
 * failing to settle does not degrade a feature — it stops the app from
 * opening, and the screen reads as "all my data is gone".
 *
 * The shape that does that is subtle enough to have shipped: resolve the
 * promise from the REQUEST's callbacks (`count`, `openCursor`, `put`) and
 * forget the TRANSACTION's. A transaction that aborts — another connection
 * holds the database, a version change is pending, quota is gone — fires
 * `onabort` and leaves its pending requests silent forever. The `onblocked`
 * handler on every `open` in `idbRename.ts` looked like coverage for that and
 * was not: the open succeeded and the transaction behind it was the thing
 * queued.
 *
 * `fake-indexeddb` completes every transaction it is given, so no behavioural
 * test here can reach that state. The bug is a missing handler, so the test
 * is that the handler is present.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** A transaction settles on exactly these three, and a promise waiting on one
 *  must hear all three — `oncomplete` alone leaves abort and error hanging. */
const TERMINAL = ["oncomplete", "onabort", "onerror"] as const;

function sources(): string[] {
	return readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}

/** Files opening a transaction, and for each the terminal events they never
 *  name. Counting per FILE rather than per transaction keeps this a readable
 *  check: a file that opens transactions and never mentions `onabort` has the
 *  bug somewhere, and that is enough to send a reader in. */
function gaps(): Array<{ file: string; missing: string[] }> {
	const out: Array<{ file: string; missing: string[] }> = [];
	for (const file of sources()) {
		const text = readFileSync(join(here, file), "utf8");
		if (!text.includes(".transaction(")) continue;
		const missing = TERMINAL.filter((e) => !text.includes(`.${e} =`) && !text.includes(`${e}:`));
		if (missing.length > 0) out.push({ file, missing });
	}
	return out;
}

describe("an awaited IndexedDB helper always settles", () => {
	it("hears every way a transaction can end, not just the happy one", () => {
		const found = gaps();
		expect(
			found,
			found
				.map((g) => `${g.file} opens a transaction but never handles ${g.missing.join(", ")}`)
				.join("\n") +
				"\n\nA transaction that aborts leaves its requests silent, so a promise " +
				"resolved only from request callbacks never settles. These run at boot, " +
				"where a promise that cannot settle takes the whole app down.",
		).toEqual([]);
	});

	it("is checking real files, so a rename cannot quietly empty it", () => {
		const checked = sources().filter((f) =>
			readFileSync(join(here, f), "utf8").includes(".transaction("),
		);
		expect(checked).toContain("idbRename.ts");
	});
});
