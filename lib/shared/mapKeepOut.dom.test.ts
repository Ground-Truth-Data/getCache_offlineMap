// @vitest-environment happy-dom
// The live measurements: the top bar's height comes from its CSS variable,
// the floor stops at the tab bar or the shovel, and the left strips are
// measured in canvas pixels on a CSS-zoomed page, hidden ones skipped.
import { afterEach, describe, expect, it } from "vitest";
import { mapKeepOutRects, readFloorY, readTopBarH, shiftClear } from "./mapKeepOut";

function at(el: HTMLElement, r: { left: number; top: number; width: number; height: number }) {
	el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) });
	return el;
}
function canvas(zoom = 1) {
	const el = at(document.createElement("div"), { left: 0, top: 100, width: 400 * zoom, height: 800 * zoom });
	Object.defineProperties(el, { offsetWidth: { value: 400 }, offsetHeight: { value: 800 } });
	return el;
}
function chrome(cls: string, r: { left: number; top: number; width: number; height: number }) {
	const el = at(document.createElement("div"), r);
	el.className = cls;
	document.body.append(el);
}
afterEach(() => {
	document.body.innerHTML = "";
	document.documentElement.style.removeProperty("--top-bar-h");
});

describe("live chrome", () => {
	it("reads the top bar height, falling back to 64", () => {
		expect(readTopBarH()).toBe(64);
		document.documentElement.style.setProperty("--top-bar-h", "88px");
		expect(readTopBarH()).toBe(88);
	});

	it("puts the floor at the higher of the tab bar and the shovel", () => {
		expect(readFloorY(canvas())).toBe(800);
		chrome("bottom-nav", { left: 0, top: 820, width: 400, height: 80 });
		chrome("shovel-handle", { left: 0, top: 700, width: 400, height: 20 });
		expect(readFloorY(canvas())).toBe(600);
		expect(readFloorY(canvas(2))).toBe(300);
	});

	it("measures the left strips in canvas px and skips a collapsed one", () => {
		chrome("draw-strip", { left: 10, top: 200, width: 60, height: 300 });
		chrome("tracking-strip", { left: 10, top: 0, width: 0, height: 0 });
		const [right, left, ...rest] = mapKeepOutRects(400, 64, canvas(2));
		expect(right).toEqual({ x: 304, y: 60, w: 96, h: 154 });
		expect(left).toEqual({ x: -3, y: 42, w: 46, h: 166 });
		expect(rest).toEqual([]);
		expect(mapKeepOutRects(400, 64)).toHaveLength(1);
	});

	it("shiftClear gives up when no lane fits", () => {
		const box = { x: 100, y: 0, w: 100, h: 10 };
		expect(shiftClear(box, [{ x: 50, y: 0, w: 300, h: 10 }], 0, 200)).toBeNull();
	});
});
