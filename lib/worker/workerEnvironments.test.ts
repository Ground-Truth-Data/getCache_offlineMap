// All three tiers must exist and hold identical bytes; never delete one as a "duplicate".
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const R2_WORKER = fileURLToPath(new URL(".", import.meta.url));

const ENVIRONMENTS = ["worker-local-dev", "worker-cloud-dev", "worker-cloud-prod"] as const;

const REQUIRED = ["tilesHost.ts", "roads/packDownload.ts", "fires/fireFetch.ts"];

/** Lines that must differ per tier, matched as a prefix. Never exempt a whole file: the rest of it then rots unseen. */
const EXPECTED_DRIFT_LINES = [
	"export const DEFAULT_TARGET",
];

const stripExpected = (body: string): string =>
	body
		.split("\n")
		.filter(
			(l) => !EXPECTED_DRIFT_LINES.some((p) => l.trimStart().startsWith(p)),
		)
		.join("\n");

describe("worker keeps ALL THREE environments", () => {
	for (const env of ENVIRONMENTS) {
		it(`${env}/ exists`, () => {
			const dir = join(R2_WORKER, env);
			expect(
				existsSync(dir) && statSync(dir).isDirectory(),
				`worker/${env}/ is MISSING.\n\n` +
					`You (or a tool) deleted an ENVIRONMENT, not a duplicate.\n` +
					`  worker-local-dev/ = the worker running on your machine (127.0.0.1:8787)\n` +
					`  worker-cloud-dev/    = the worker DEPLOYED to tiles-dev.getcache.org\n` +
					`  worker-cloud-prod/   = the worker DEPLOYED to tiles-prod.getcache.org, serving users\n\n` +
					`They hold identical bytes on purpose: the same code at two stages of\n` +
					`readiness. That is what lets you break dev all day without touching\n` +
					`what is live.\n\n` +
					`Restore it — git log will have it — and read README.md next to this\n` +
					`test before touching this folder again.`,
			).toBe(true);
		});

		it(`${env}/ still has its worker files`, () => {
			const missing = REQUIRED.filter(
				(f) => !existsSync(join(R2_WORKER, env, f)),
			);
			expect(
				missing,
				`worker/${env}/ exists but has been gutted. Missing:\n` +
					missing.map((m) => `  ${m}`).join("\n") +
					`\n\nAn environment that cannot serve tiles is not an environment.`,
			).toEqual([]);
		});
	}

	const filesOf = (env: string): string[] => {
		const walk = (d: string, prefix = ""): string[] =>
			readdirSync(d, { withFileTypes: true })
				.filter((e) => !e.name.startsWith("."))
				.flatMap((e) =>
					e.isDirectory()
						? walk(join(d, e.name), `${prefix}${e.name}/`)
						: [`${prefix}${e.name}`],
				);
		return walk(join(R2_WORKER, env)).sort();
	};

	it("every environment carries the same file names (identical is CORRECT)", () => {
		const names = ENVIRONMENTS.map(filesOf);

		for (let i = 1; i < names.length; i++) {
			expect(
				names[0],
				`${ENVIRONMENTS[0]}/ and ${ENVIRONMENTS[i]}/ no longer hold the same file names.\n` +
					`That is not automatically wrong — but it is a DECISION. If they have\n` +
					`deliberately diverged, update this test and README.md to say how.\n` +
					`Never resolve it by deleting one side.`,
			).toEqual(names[i]);
		}
	});

	it("every environment carries the same file CONTENTS (bytes, not names)", () => {
		const drifted: string[] = [];
		for (const rel of filesOf(ENVIRONMENTS[0])) {
			const bodies = ENVIRONMENTS.map((env) =>
				stripExpected(readFileSync(join(R2_WORKER, env, rel), "utf8")),
			);
			for (let i = 1; i < bodies.length; i++)
				if (bodies[i] !== bodies[0]) {
					drifted.push(
						`  ${rel} — ${ENVIRONMENTS[i]} differs from ${ENVIRONMENTS[0]}`,
					);
					break;
				}
		}
		expect(
			drifted,
			`These files differ between environments:\n${drifted.join("\n")}\n\n` +
				`A tier that did not get the update ships behaviour nobody chose.\n` +
				`Bring the lagging tier up to date, or — if the difference is\n` +
				`deliberate — add the path to EXPECTED_DRIFT with the reason.\n` +
				`Never resolve this by deleting a tier.`,
		).toEqual([]);
	});
});
