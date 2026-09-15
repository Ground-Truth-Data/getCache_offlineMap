import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { noRawCamera } from "./noRawCameraPlugin";

// The predecessor of this guard (ReTreever/scripts/check-direct-mapbox-camera.sh)
// passed green for weeks while grepping paths the map code had already left. So
// the load-bearing assertion here is not "clean code passes" — it is that the
// guard FIRES on a real violation. A guard that cannot fail is not a guard.

const ROOT = mkdtempSync(join(tmpdir(), "raw-camera-"));

/** Run the plugin over one fake module; returns the error message, or null. */
function check(name: string, source: string): string | null {
	const file = join(ROOT, name);
	writeFileSync(file, source);

	const plugin = noRawCamera(ROOT);
	let message: string | null = null;

	const ctx = {
		error(e: string | Error) {
			message = typeof e === "string" ? e : e.message;
		},
	};

	(plugin.transform as (this: unknown, c: string, i: string) => unknown).call(
		ctx,
		source,
		file,
	);
	(plugin.buildEnd as (this: unknown) => void).call(ctx);

	return message;
}

describe("noRawCamera", () => {
	it("FIRES on a direct camera call", () => {
		const err = check("bad.ts", "map.flyTo({ center: c, zoom: 12 });\n");
		expect(err).not.toBeNull();
		expect(err).toContain("bad.ts:1");
		expect(err).toContain("safeMap.ts");
	});

	it("reports the real line number", () => {
		const err = check("line.ts", "const a = 1;\n\nmap.easeTo({ zoom });\n");
		expect(err).toContain("line.ts:3");
	});

	it("catches every camera method, not just flyTo", () => {
		for (const m of [
			"fitBounds",
			"easeTo",
			"jumpTo",
			"panTo",
			"setCenter",
			"setZoom",
			"setBearing",
			"setPitch",
		]) {
			expect(check(`m-${m}.ts`, `map.${m}(x);\n`), m).not.toBeNull();
		}
	});

	it("passes code that uses the safeMap wrappers", () => {
		expect(check("good.ts", "safeFlyTo(map, { center: c });\n")).toBeNull();
	});

	it("ignores the wrappers' own files", () => {
		expect(check("safeMap.ts", "map.flyTo({ center: c });\n")).toBeNull();
		expect(check("mapInit.ts", "map.jumpTo({ center: c });\n")).toBeNull();
	});

	it("does not match a call inside a comment or a string", () => {
		expect(check("cmt.ts", "// map.flyTo({}) is banned\n")).toBeNull();
		expect(check("blk.ts", "/*\n map.easeTo({})\n*/\n")).toBeNull();
		expect(check("str.ts", 'const s = "map.flyTo(x)";\n')).toBeNull();
	});

	it("honours an annotated escape hatch", () => {
		expect(
			check(
				"esc.ts",
				"// camera-allow-raw: restoring a known-finite last-good view\nmap.jumpTo(saved);\n",
			),
		).toBeNull();
	});

	it("still fires when a DIFFERENT line carries the annotation", () => {
		const err = check(
			"esc2.ts",
			"// camera-allow-raw: this one is fine\nmap.jumpTo(saved);\n\nmap.flyTo(computed);\n",
		);
		expect(err).toContain("esc2.ts:4");
	});
});
