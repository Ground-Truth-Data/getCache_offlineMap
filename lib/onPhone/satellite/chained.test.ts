import { describe, expect, it } from "vitest";
import { chained } from "./mountSatellite";

describe("chained", () => {
	it("joins a staircase's sides into one run, so its corners get a join", () => {
		const sides: [number, number][][] = [[[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [2, 1]]];
		expect(chained(sides)).toEqual([[[0, 0], [1, 0], [1, 1], [2, 1]]]);
	});

	it("starts a closed square mid-side, so no corner is a cap", () => {
		const sides: [number, number][][] = [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]];
		const [run] = chained(sides);
		expect(run).toEqual([[0.5, 0], [1, 0], [1, 1], [0, 1], [0, 0], [0.5, 0]]);
	});
});
