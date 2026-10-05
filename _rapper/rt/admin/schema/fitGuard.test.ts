import { describe, expect, it } from "vitest";

// A fit against an unmeasured box (pre-layout ResizeObserver fire) has no
// correct answer, so the only safe result is to refuse, not scale(0).
const MIN_SCALE = 0.08;
const MAX_SCALE = 2.5;
const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));

function fitScale(
	view: { width: number; height: number },
	sheet: { w: number; h: number },
): number | null {
	if (view.width < 1 || view.height < 1) return null;
	if (sheet.w < 1 || sheet.h < 1) return null;
	return clamp(Math.min(view.width / sheet.w, view.height / sheet.h) * 0.96);
}

describe("fit", () => {
	it("refuses a viewport that has not been laid out yet", () => {
		expect(fitScale({ width: 0, height: 0 }, { w: 1400, h: 3000 })).toBeNull();
	});

	// Width arrives first while the flex parent resolves; guarding only width still lets a zero through.
	it("refuses a box with width but no height", () => {
		expect(fitScale({ width: 1200, height: 0 }, { w: 1400, h: 3000 })).toBeNull();
	});

	it("refuses a sheet that has no size yet", () => {
		expect(fitScale({ width: 1200, height: 800 }, { w: 0, h: 0 })).toBeNull();
	});

	it("fits a real box to a real sheet", () => {
		const s = fitScale({ width: 1200, height: 800 }, { w: 1400, h: 3000 });
		expect(s).not.toBeNull();
		expect(s).toBeGreaterThan(0);
		expect((s as number) * 3000).toBeLessThanOrEqual(800);
	});

	// The floor keeps a tall sheet in a short window from computing a near-zero scale — the same blank screen by a different route.
	it("never returns a scale that collapses the sheet", () => {
		const s = fitScale({ width: 300, height: 200 }, { w: 4000, h: 40000 });
		expect(s).toBe(MIN_SCALE);
	});
});
