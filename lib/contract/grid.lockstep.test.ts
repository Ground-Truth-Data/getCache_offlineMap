/**
 * The Worker decides which cell it BUILT; the phone decides which cell to ASK
 * FOR. A disagreement by one rounding rule is a silently blank map, so this
 * compares the FILES, not a constant in them. Skips when the Worker folder is
 * absent (a checkout that dropped it on purpose).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOB_TILE_Z, GRID_RADIUS_KM, cellOf, cellsFor } from "./grid";

const workerGrid = fileURLToPath(
	new URL("../../workers/worker-local-dev/src/grid.ts", import.meta.url),
);
const clientGrid = fileURLToPath(new URL("./grid.ts", import.meta.url));

const haveWorker = existsSync(workerGrid);

describe("the grid is ONE definition", () => {
	it.skipIf(!haveWorker)("⛔ the Worker's grid.ts and the client's are IDENTICAL", () => {
		const worker = readFileSync(workerGrid, "utf8");
		const reexport = /export \* from ["']([^"']+)["']/.exec(worker)?.[1];
		if (reexport) {
			expect(resolve(dirname(workerGrid), `${reexport}.ts`)).toBe(clientGrid);
		} else {
			expect(readFileSync(clientGrid, "utf8")).toBe(worker);
		}
	});

	it("the cell zoom and the radius are both real numbers", () => {
		expect(BLOB_TILE_Z).toBeGreaterThanOrEqual(8);
		expect(GRID_RADIUS_KM).toBeGreaterThan(0);
	});

	it("a real anchor resolves to a cell and a small cell list", () => {
		const cells = cellsFor(-111.5, 46.6);
		expect(cells.length).toBeGreaterThanOrEqual(1);
		expect(cells.length).toBeLessThanOrEqual(25);
		expect(cells[0]).toEqual(cellOf(-111.5, 46.6));
	});
});
