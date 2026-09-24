// workers/worker-local-dev is edited and run locally; the two cloud folders are
// the record of what each tier runs, overwritten by their deploy scripts.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const at = (p: string) =>
	fileURLToPath(new URL(`../../workers/${p}`, import.meta.url));

describe("workers/ layout", () => {
	it("has all three tier folders, each with the worker source and config", () => {
		for (const tier of ["worker-local-dev", "worker-cloud-dev", "worker-cloud-prod"]) {
			for (const f of ["src/index.ts", "wrangler.toml", "package.json"]) {
				expect(existsSync(at(`${tier}/${f}`)), `workers/${tier}/${f}`).toBe(true);
			}
		}
	});

	it("keeps the local runner in worker-local-dev and a deploy script in each cloud tier", () => {
		const localScripts = JSON.parse(
			readFileSync(at("worker-local-dev/package.json"), "utf8"),
		).scripts;
		expect(localScripts.dev).toBe("wrangler dev");
		expect(existsSync(at("worker-cloud-dev/deployDev.sh"))).toBe(true);
		expect(existsSync(at("worker-cloud-prod/deployProduction.sh"))).toBe(true);
	});

	it("never grows the old single worker/ folder back", () => {
		expect(
			existsSync(fileURLToPath(new URL("../../worker", import.meta.url))),
			"worker/ exists again — a merge resurrected the pre-split folder; its contents belong in workers/worker-local-dev",
		).toBe(false);
	});
});
