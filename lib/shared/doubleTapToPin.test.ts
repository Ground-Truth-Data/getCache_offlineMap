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
		detach = attachDoubleTapToPin(map, { onDrop: () => {}, onMeasureSeed: seed });
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
