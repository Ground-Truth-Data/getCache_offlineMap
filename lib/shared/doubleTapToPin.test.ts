import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, attachDoubleTapToPin } from "./doubleTapToPin";

// Node has EventTarget and Event but no DOM: a window plus the two pointer event classes the detector
// duck-types against is all the real thing needs.
class FakeMouseEvent extends Event {
	clientX: number;
	clientY: number;
	button = 0;
	constructor(type: string, x = 0, y = 0) {
		super(type);
		this.clientX = x;
		this.clientY = y;
	}
}
class FakeTouchEvent extends Event {
	touches: { clientX: number; clientY: number }[];
	constructor(type: string, touches: [number, number][]) {
		super(type);
		this.touches = touches.map(([clientX, clientY]) => ({ clientX, clientY }));
	}
}

function fakeMap() {
	const listeners = new Map<string, Set<(e: unknown) => void>>();
	return {
		doubleClickZoom: { disable() {} },
		dragPan: { enable() {}, disable() {} },
		getCanvas: () =>
			({ offsetWidth: 400, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400 }) }) as HTMLCanvasElement,
		unproject: ([x, y]: [number, number]) => ({ lng: x, lat: y }),
		on(type: string, fn: (e: unknown) => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(fn);
		},
		off(type: string, fn: (e: unknown) => void) {
			listeners.get(type)?.delete(fn);
		},
		fire(type: string, originalEvent: Event) {
			for (const fn of listeners.get(type) ?? [])
				fn({ originalEvent, lngLat: { lng: 1, lat: 2 }, point: { x: 0, y: 0 } });
		},
	};
}

const g = globalThis as Record<string, unknown>;
const saved = { window: g.window, MouseEvent: g.MouseEvent, TouchEvent: g.TouchEvent };

describe("long press vs drag", () => {
	let map: ReturnType<typeof fakeMap>;
	let seed: ReturnType<typeof vi.fn>;
	let detach: () => void;

	beforeEach(() => {
		vi.useFakeTimers();
		g.window = new EventTarget();
		g.MouseEvent = FakeMouseEvent;
		g.TouchEvent = FakeTouchEvent;
		map = fakeMap();
		seed = vi.fn();
		detach = attachDoubleTapToPin(map, { onMeasureSeed: seed });
	});
	afterEach(() => {
		detach();
		vi.useRealTimers();
		Object.assign(g, saved);
	});

	it("a still press seeds the ruler", () => {
		map.fire("mousedown", new FakeMouseEvent("mousedown", 100, 100));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(seed).toHaveBeenCalledTimes(1);
	});

	// Mapbox mutes its mousemove map event the moment its pan takes over (3 px), so the only
	// evidence of a mouse drag is the raw DOM event.
	it("a mouse drag the map swallowed never seeds, however long the hold after it", () => {
		map.fire("mousedown", new FakeMouseEvent("mousedown", 100, 100));
		(g.window as EventTarget).dispatchEvent(new FakeMouseEvent("mousemove", 300, 100));
		vi.advanceTimersByTime(2000);
		expect(seed).not.toHaveBeenCalled();
	});

	it("a touch drag never seeds", () => {
		map.fire("touchstart", new FakeTouchEvent("touchstart", [[100, 100]]));
		(g.window as EventTarget).dispatchEvent(new FakeTouchEvent("touchmove", [[300, 100]]));
		vi.advanceTimersByTime(2000);
		expect(seed).not.toHaveBeenCalled();
	});

	it("a second finger is a pinch, never a press", () => {
		map.fire("touchstart", new FakeTouchEvent("touchstart", [[100, 100]]));
		map.fire("touchstart", new FakeTouchEvent("touchstart", [[100, 100], [200, 200]]));
		vi.advanceTimersByTime(2000);
		expect(seed).not.toHaveBeenCalled();
	});
});

describe("touch hold extends the arm", () => {
	let map: ReturnType<typeof fakeMap>;
	let seed: ReturnType<typeof vi.fn>;
	let detach: () => void;
	const touch = (type: string, ...pts: [number, number][]) => new FakeTouchEvent(type, pts);
	const move = (x: number, y: number) => (g.window as EventTarget).dispatchEvent(touch("touchmove", [x, y]));

	beforeEach(() => {
		vi.useFakeTimers();
		g.window = new EventTarget();
		g.MouseEvent = FakeMouseEvent;
		g.TouchEvent = FakeTouchEvent;
		map = fakeMap();
		seed = vi.fn();
		detach = attachDoubleTapToPin(map, { onMeasureSeed: seed });
	});
	afterEach(() => {
		detach();
		vi.useRealTimers();
		Object.assign(g, saved);
	});

	it("seeds at the fingertip, up-left of the finger, only on lift", () => {
		map.fire("touchstart", touch("touchstart", [200, 300]));
		vi.advanceTimersByTime(300);
		move(220, 310);
		expect(seed).not.toHaveBeenCalled();
		map.fire("touchend", touch("touchend"));
		expect(seed).toHaveBeenCalledWith(170, 230);
	});

	it("a quick tap never seeds", () => {
		map.fire("touchstart", touch("touchstart", [200, 300]));
		vi.advanceTimersByTime(200);
		map.fire("touchend", touch("touchend"));
		vi.advanceTimersByTime(2000);
		expect(seed).not.toHaveBeenCalled();
	});

	it("a second finger mid-aim cancels without committing", () => {
		map.fire("touchstart", touch("touchstart", [200, 300]));
		vi.advanceTimersByTime(300);
		map.fire("touchstart", touch("touchstart", [200, 300], [250, 350]));
		map.fire("touchend", touch("touchend"));
		expect(seed).not.toHaveBeenCalled();
	});

	it("flips below and right of the finger near the top-left corner", () => {
		map.fire("touchstart", touch("touchstart", [20, 90]));
		vi.advanceTimersByTime(300);
		map.fire("touchend", touch("touchend"));
		expect(seed).toHaveBeenCalledWith(70, 170);
	});
});
