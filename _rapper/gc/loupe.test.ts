import { describe, expect, it } from "vitest";
import { LOUPE_GAP, LOUPE_H, LOUPE_W, LOUPE_ZOOM, RING_PAD, TICKS, capsuleTicks, loupeAt, loupeFrame } from "./Loupe.svelte";

// Where a source backing pixel lands in the lens's backing store after drawImage(src, s…, d…).
function landing(f: ReturnType<typeof loupeFrame>, bx: number, by: number) {
	return {
		x: f.dx + ((bx - f.sx) * f.dw) / f.sw,
		y: f.dy + ((by - f.sy) * f.dh) / f.sh,
	};
}

describe("the loupe shows the map under the finger", () => {
	it("the finger's own pixel is the crosshair, whatever the source and lens ratios", () => {
		for (const [s, dpr] of [
			[1, 1],
			[2, 2],
			[3, 2],
			[1.5, 3],
		]) {
			const f = loupeFrame(200 * s, 300 * s, s, 390 * s, 844 * s, dpr);
			const l = landing(f, 200 * s, 300 * s);
			expect(l.x).toBeCloseTo((LOUPE_W * dpr) / 2, 6);
			expect(l.y).toBeCloseTo((LOUPE_H * dpr) / 2, 6);
		}
	});

	it("a pin 5 px right of the finger sits 5 × zoom px right of the crosshair", () => {
		const f = loupeFrame(400, 600, 2, 780, 1688, 2);
		expect(landing(f, 410, 600).x).toBeCloseTo(LOUPE_W + 5 * LOUPE_ZOOM * 2, 6);
	});

	it("clipped at the canvas edge, the finger stays dead centre instead of the view stretching", () => {
		const f = loupeFrame(20, 600, 2, 780, 1688, 2);
		expect(f.sx).toBe(0);
		expect(f.dw / f.sw).toBeCloseTo(LOUPE_ZOOM, 6);
		expect(landing(f, 20, 600).x).toBeCloseTo(LOUPE_W, 6);
	});

	it("floats above the finger, beside it near the top, never past the side edges", () => {
		expect(loupeAt(200, 400, 390)).toEqual({ x: 200, y: 400 - LOUPE_GAP - LOUPE_H / 2 });
		// Too close to the top: to the right of a finger on the left half, and no higher than 50 px.
		expect(loupeAt(100, 120, 390)).toEqual({ x: 100 + LOUPE_W / 2 + 44, y: 120 });
		// On the right half it goes left; 14 px keeps it on screen.
		expect(loupeAt(380, 120, 390)).toEqual({ x: 380 - LOUPE_W / 2 - 44, y: 120 });
		expect(loupeAt(5, 400, 390).x).toBe(14 + LOUPE_W / 2);
	});
});

describe("the ruler ticks", () => {
	const ticks = capsuleTicks();
	const W = LOUPE_W + 2 * RING_PAD;
	const H = LOUPE_H + 2 * RING_PAD;

	it("are 36, the first at top centre pointing straight up, every sixth major", () => {
		expect(ticks).toHaveLength(TICKS);
		const t0 = ticks[0];
		expect(t0.major).toBe(true);
		expect((t0.x1 + t0.x2) / 2).toBeCloseTo(W / 2, 6);
		expect(t0.x1).toBeCloseTo(t0.x2, 6);
		expect(Math.abs(t0.y2 - t0.y1)).toBeCloseTo(8, 6);
		expect(ticks.filter((t) => t.major)).toHaveLength(6);
		expect(Math.abs(ticks[1].y2 - ticks[1].y1)).toBeCloseTo(4.4, 6);
	});

	it("sit on the capsule, crossing it at right angles", () => {
		const R = H / 2;
		for (const t of ticks) {
			const mx = (t.x1 + t.x2) / 2;
			const my = (t.y1 + t.y2) / 2;
			// Distance from the capsule's spine (the segment between the cap centres) equals the radius.
			const sx = Math.min(Math.max(mx, R), W - R);
			expect(Math.hypot(mx - sx, my - R)).toBeCloseTo(R, 6);
			// The tick points along the outward normal: from the spine through the midpoint.
			const nx = (mx - sx) / R;
			const ny = (my - R) / R;
			const tx = t.x2 - t.x1;
			const ty = t.y2 - t.y1;
			expect(Math.abs(tx * ny - ty * nx)).toBeLessThan(1e-6);
		}
	});

	it("go clockwise from the top: tick 9 is on the right, 18 at the bottom, 27 on the left", () => {
		expect(ticks[9].x1).toBeGreaterThan(W - 10);
		expect(ticks[18].y1).toBeGreaterThan(H - 10);
		expect(ticks[27].x1).toBeLessThan(10);
	});
});
