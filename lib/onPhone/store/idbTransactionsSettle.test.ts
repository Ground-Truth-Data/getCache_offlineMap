/**
 * Every IndexedDB helper here is awaited by boot. A transaction that aborts
 * leaves its requests silent, so a promise resolved from request callbacks
 * alone never settles. `fake-indexeddb` completes every transaction, so the
 * test is that the handler is present.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

const TERMINAL = ["oncomplete", "onabort", "onerror"] as const;

function sources(): string[] {
	return readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}

/** Per file, not per transaction: enough to send a reader in. */
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
		expect(checked).toContain("keyedIdbStore.ts");
	});
});
