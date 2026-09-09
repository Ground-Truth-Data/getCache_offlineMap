import { describe, expect, it } from "vitest";
import { type ControlPoint, pairedOnly, quality, solve } from "./controlPoints";

const PAGE = { width: 800, height: 600 };

/** A sheet placed with no rotation: 800x600 page over ~1 km of ground near
 *  Kelowna, so metre errors are the size they'd be in the field. */
const LNG0 = -119.5;
const LAT0 = 49.8;
const DEG_PER_PX_LNG = 0.00002;
const DEG_PER_PX_LAT = -0.000013;

function truePlace(x: number, y: number): { lng: number; lat: number } {
	return { lng: LNG0 + x * DEG_PER_PX_LNG, lat: LAT0 + y * DEG_PER_PX_LAT };
}

function pt(id: number, x: number, y: number): ControlPoint {
	return { id, page: { x, y }, map: truePlace(x, y) };
}

describe("solve", () => {
	it("returns null until three points are paired", () => {
		expect(solve([], PAGE)).toBeNull();
		expect(solve([pt(1, 100, 100)], PAGE)).toBeNull();
		expect(solve([pt(1, 100, 100), pt(2, 700, 120)], PAGE)).toBeNull();
	});

	it("ignores a point whose map half is still owed", () => {
		const half: ControlPoint = { id: 3, page: { x: 400, y: 500 } };
		expect(solve([pt(1, 100, 100), pt(2, 700, 120), half], PAGE)).toBeNull();
	});

	it("recovers the placement from three exact points", () => {
		const s = solve([pt(1, 100, 100), pt(2, 700, 120), pt(3, 400, 500)], PAGE);
		expect(s).not.toBeNull();
		const tl = truePlace(0, 0);
		const br = truePlace(PAGE.width, PAGE.height);
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(s!.quad[0][0]).toBeCloseTo(tl.lng, 6);
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(s!.quad[0][1]).toBeCloseTo(tl.lat, 6);
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(s!.quad[2][0]).toBeCloseTo(br.lng, 6);
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(s!.quad[2][1]).toBeCloseTo(br.lat, 6);
	});

	it("orders the quad clockwise from the top-left", () => {
		const s = solve([pt(1, 100, 100), pt(2, 700, 120), pt(3, 400, 500)], PAGE);
		// biome-ignore lint/style/noNonNullAssertion: three exact points always fit
		const [tl, tr, br, bl] = s!.quad;
		expect(tr[0]).toBeGreaterThan(tl[0]);
		expect(br[0]).toBeGreaterThan(bl[0]);
		expect(tl[1]).toBeGreaterThan(bl[1]);
		expect(tr[1]).toBeGreaterThan(br[1]);
	});

	it("reports near-zero residuals for an exact fit", () => {
		const s = solve([pt(1, 100, 100), pt(2, 700, 120), pt(3, 400, 500)], PAGE);
		// biome-ignore lint/style/noNonNullAssertion: three exact points always fit
		for (const r of s!.residualsM) expect(r).toBeLessThan(0.5);
	});

	it("blames the misplaced point, not its neighbours", () => {
		// A fourth point dropped ~40 m east of where it belongs. Least-squares
		// spreads some error everywhere, but the culprit must be worst by far —
		// that is what lets the user see WHICH tap to fix.
		const bad = pt(4, 200, 400);
		bad.map = { lng: bad.map.lng + 0.0006, lat: bad.map.lat };
		const s = solve(
			[pt(1, 100, 100), pt(2, 700, 120), pt(3, 400, 500), bad],
			PAGE,
		);
		expect(s).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		const rs = s!.residualsM;
		const worst = Math.max(...rs);
		expect(rs[3]).toBe(worst);
		expect(worst).toBeGreaterThan(10);
	});

	it("refuses a fit whose points contradict each other", () => {
		// Three points whose map halves bear no relation to the page: the solver
		// must return null rather than lay a nonsense sheet on the map.
		const scrambled: ControlPoint[] = [
			{ id: 1, page: { x: 100, y: 100 }, map: { lng: -119.5, lat: 49.8 } },
			{ id: 2, page: { x: 700, y: 120 }, map: { lng: -119.9, lat: 49.2 } },
			{ id: 3, page: { x: 400, y: 500 }, map: { lng: -118.6, lat: 50.4 } },
			{ id: 4, page: { x: 410, y: 505 }, map: { lng: -119.1, lat: 49.4 } },
		];
		expect(solve(scrambled, PAGE)).toBeNull();
	});

	it("handles a rotated sheet — a map printed off-north", () => {
		const rot = (Math.PI / 180) * 25;
		const place = (x: number, y: number) => ({
			lng: LNG0 + (x * Math.cos(rot) - y * Math.sin(rot)) * DEG_PER_PX_LNG,
			lat: LAT0 + (x * Math.sin(rot) + y * Math.cos(rot)) * DEG_PER_PX_LAT,
		});
		const pts: ControlPoint[] = [
			{ id: 1, page: { x: 100, y: 100 }, map: place(100, 100) },
			{ id: 2, page: { x: 700, y: 120 }, map: place(700, 120) },
			{ id: 3, page: { x: 400, y: 500 }, map: place(400, 500) },
		];
		const s = solve(pts, PAGE);
		expect(s).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		for (const r of s!.residualsM) expect(r).toBeLessThan(0.5);
	});
});

describe("pairedOnly", () => {
	it("drops the half-entered pair", () => {
		const pts: ControlPoint[] = [pt(1, 10, 10), { id: 2, page: { x: 20, y: 20 } }];
		expect(pairedOnly(pts)).toHaveLength(1);
		expect(pairedOnly(pts)[0].id).toBe(1);
	});
});

describe("quality", () => {
	it("bands a residual into something a planter can act on", () => {
		expect(quality(0)).toBe("good");
		expect(quality(20)).toBe("good");
		expect(quality(21)).toBe("fair");
		expect(quality(100)).toBe("fair");
		expect(quality(101)).toBe("off");
	});
});
