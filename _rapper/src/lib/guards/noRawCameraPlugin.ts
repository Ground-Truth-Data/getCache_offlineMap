import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Plugin } from "vite";

/**
 * Camera mutations go through safeMap.ts. Enforced by the build, not by trust.
 *
 * A NaN reaching Mapbox/MapLibre projection math corrupts the camera's internal
 * state permanently: every LATER call, valid or not, then dies in
 * `_calcMatrices` with "Cannot read properties of null". The crash stack points
 * at renderer internals, never at the call that poisoned it, so the leak is
 * near-impossible to trace after the fact. `safeMap.ts` validates every camera
 * argument at the boundary; a direct `map.flyTo(...)` bypasses it.
 *
 * WHY A VITE PLUGIN AND NOT THE SHELL SCRIPT THIS REPLACES
 * `ReTreever/scripts/check-direct-mapbox-camera.sh` encoded this same rule and
 * was wired into no build, no test and no hook. Worse, it grepped `../rapper/src`
 * and `src` — paths the map code left when the shared tree moved on 29 Aug 2026
 * — so it scanned ZERO files and printed "OK: all Mapbox camera mutations go
 * through safeMap.ts" on every run. A check that examines nothing must never
 * report success. Meanwhile seven swallow-the-throw patches accumulated in
 * safeMarker.ts downstream, each catching a symptom of the coords this guard
 * was supposed to stop.
 *
 * As a plugin it is `vite build` itself: throw here and there is no bundle, so
 * there is nothing to deploy. It cannot be skipped the way a lint rule can.
 *
 * WHY A SOURCE SCAN AND NOT resolveId
 * Unlike noEscapePlugin, the thing being forbidden is a method CALL, not an
 * import — Rollup never hands those to a hook. So this reads transformed source
 * and matches the call shape. That means it sees only modules that enter the
 * graph, which is the right scope: dead code cannot poison a camera.
 */

const CAMERA_METHODS = [
	"flyTo",
	"fitBounds",
	"easeTo",
	"jumpTo",
	"panTo",
	"setCenter",
	"setZoom",
	"setBearing",
	"setPitch",
] as const;

const CALL = new RegExp(`\\.(${CAMERA_METHODS.join("|")})\\s*\\(`, "g");

/**
 * Files permitted to call the renderer directly.
 *
 * safeMap/safeEase ARE the wrappers. mapInit constructs the map and repairs a
 * degenerate transform, which necessarily means writing the camera before any
 * wrapper exists to route through.
 */
const ALLOWED = /(?:safeMap|safeEase|mapInit)\.ts$/;

const SKIP =
	/node_modules|\.svelte-kit|[/\\]_rapper[/\\]|\.(?:test|spec)\.[tj]s$|[/\\]tests?[/\\]/;

/** `// camera-allow-raw: <reason>` on the call's line or the one above it. */
function hasEscape(lines: string[], lineIdx: number): boolean {
	const here = lines[lineIdx] ?? "";
	const above = lines[lineIdx - 1] ?? "";
	return /camera-allow-raw:/.test(here) || /camera-allow-raw:/.test(above);
}

/**
 * A comment or string is not a call. Cheap, deliberate approximation: strip
 * block comments, line comments and string literals before matching. The
 * alternative is a parser, which is a large dependency for a guard whose false
 * positives are one annotation away from silenced.
 */
function stripNonCode(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) =>
			m.replace(/[^\n]/g, " "),
		);
}

export function noRawCamera(workspaceRoot: string): Plugin {
	const violations: string[] = [];

	return {
		name: "no-raw-camera",
		apply: "build",
		enforce: "pre",

		transform(code, id) {
			const file = id.split("?")[0];
			if (SKIP.test(file) || ALLOWED.test(file)) return null;
			if (!/\.(?:ts|svelte)$/.test(file)) return null;
			// Cheap reject before the expensive strip.
			if (!CAMERA_METHODS.some((m) => code.includes(`.${m}`))) return null;

			// Read from disk: `code` may be post-transform (Svelte compiled to
			// JS), where line numbers no longer match the file a human opens.
			let src: string;
			try {
				src = readFileSync(file, "utf8");
			} catch {
				return null;
			}

			const lines = src.split("\n");
			const scan = stripNonCode(src).split("\n");

			scan.forEach((line, i) => {
				CALL.lastIndex = 0;
				let m: RegExpExecArray | null = CALL.exec(line);
				while (m !== null) {
					if (!hasEscape(lines, i)) {
						violations.push(
							`  ${relative(workspaceRoot, file)}:${i + 1}  .${m[1]}(`,
						);
					}
					m = CALL.exec(line);
				}
			});

			return null;
		},

		buildEnd() {
			if (violations.length === 0) return;
			const seen = [...new Set(violations)].sort();
			this.error(
				`Direct renderer camera calls bypass safeMap.ts (${seen.length}):\n\n` +
					`${seen.join("\n")}\n\n` +
					"A NaN reaching the camera corrupts it for every later call, and the\n" +
					"crash surfaces deep in renderer internals with no trace of the caller.\n\n" +
					"Fix: safeFlyTo(map, …) / safeFitBounds(map, …) / safeEaseTo(map, …) /\n" +
					"safeJumpTo(map, …) from safeMap.ts. Build coords with toCoord() at the\n" +
					"boundary so validation happens once, where the value is born.\n\n" +
					"Genuinely unavoidable? Annotate the line with\n" +
					"  // camera-allow-raw: <why this one cannot go through safeMap>",
			);
		},
	};
}
