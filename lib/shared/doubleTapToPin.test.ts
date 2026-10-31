import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { ACTIVATE_MS, HOLD_MS, attachDoubleTapToPin } from "./doubleTapToPin";

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

function rig() {
	let map: ReturnType<typeof fakeMap>;
	let seed: Mock<(lng: number, lat: number) => void>;
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
	return { map: () => map, seed: () => seed };
}

describe("mouse: the hold, the drag, the tap", () => {
	const r = rig();
	const move = (x: number, y: number) => (g.window as EventTarget).dispatchEvent(new FakeMouseEvent("mousemove", x, y));

	// Desktop rehearses the phone: a press rested a full hold seeds under the pointer, still down.
	it("a press held still seeds under the pointer the moment the hold fills", () => {
		r.map().fire("mousedown", new FakeMouseEvent("mousedown", 200, 300));
		vi.advanceTimersByTime(ACTIVATE_MS + HOLD_MS - 1);
		expect(r.seed()).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(r.seed()).toHaveBeenCalledWith(200, 300);
		move(260, 340);
		vi.advanceTimersByTime(2000);
		r.map().fire("mouseup", new FakeMouseEvent("mouseup", 260, 340));
		expect(r.seed()).toHaveBeenCalledTimes(1);
	});

	it("under the loupe a fat-finger wobble keeps the countdown; past the slop the ruler drops for a drag", () => {
		const phases: string[] = [];
		(g.window as EventTarget).addEventListener("gc-press", (e) => phases.push((e as CustomEvent).detail.phase));
		r.map().fire("mousedown", new FakeMouseEvent("mousedown", 200, 300));
		vi.advanceTimersByTime(ACTIVATE_MS + 500);
		move(202, 301);
		vi.advanceTimersByTime(HOLD_MS - 500);
		expect(r.seed()).toHaveBeenCalledWith(202, 301);
		r.map().fire("mouseup", new FakeMouseEvent("mouseup", 202, 301));
		r.map().fire("mousedown", new FakeMouseEvent("mousedown", 200, 300));
		vi.advanceTimersByTime(ACTIVATE_MS + 500);
		phases.length = 0;
		move(210, 300);
		vi.advanceTimersByTime(HOLD_MS * 2);
		expect(r.seed()).toHaveBeenCalledTimes(1);
		expect(phases).toEqual(["end", "drag"]);
	});

	// A ruler hand is the handle: holding it must not also bring a loupe up over it.
	it("a press on a marker never starts a hold", () => {
		const onMarker = new FakeTouchEvent("touchstart", [[100, 100]]);
		Object.defineProperty(onMarker, "target", { value: { closest: (sel: string) => (sel.includes("marker") ? {} : null) } });
		r.map().fire("touchstart", onMarker);
		vi.advanceTimersByTime(2000);
		r.map().fire("touchend", new FakeTouchEvent("touchend", []));
		expect(r.seed()).not.toHaveBeenCalled();
	});

	// Mapbox mutes its mousemove map event the moment its pan takes over (3 px), so the only
	// evidence of a mouse drag is the raw DOM event.
	it("a mouse drag the map swallowed never seeds, however long the hold after it", () => {
		r.map().fire("mousedown", new FakeMouseEvent("mousedown", 100, 100));
		move(300, 100);
		vi.advanceTimersByTime(2000);
		r.map().fire("mouseup", new FakeMouseEvent("mouseup", 300, 100));
		expect(r.seed()).not.toHaveBeenCalled();
	});
});

describe("touch: the hold, the pinch, the tap", () => {
	const r = rig();
	const touch = (type: string, ...pts: [number, number][]) => new FakeTouchEvent(type, pts);
	const move = (x: number, y: number) => (g.window as EventTarget).dispatchEvent(touch("touchmove", [x, y]));

	it("seeds under the finger, wobble and all, with the finger still down", () => {
		r.map().fire("touchstart", touch("touchstart", [200, 300]));
		vi.advanceTimersByTime(ACTIVATE_MS);
		move(203, 302);
		vi.advanceTimersByTime(HOLD_MS - 1);
		expect(r.seed()).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(r.seed()).toHaveBeenCalledWith(203, 302);
		r.map().fire("touchend", touch("touchend"));
		expect(r.seed()).toHaveBeenCalledTimes(1);
	});

	it("a quick tap never seeds", () => {
		r.map().fire("touchstart", touch("touchstart", [200, 300]));
		vi.advanceTimersByTime(200);
		r.map().fire("touchend", touch("touchend"));
		vi.advanceTimersByTime(2000);
		expect(r.seed()).not.toHaveBeenCalled();
	});

	it("a touch drag never seeds", () => {
		r.map().fire("touchstart", touch("touchstart", [100, 100]));
		move(300, 100);
		vi.advanceTimersByTime(2000);
		expect(r.seed()).not.toHaveBeenCalled();
	});

	// The hand fists at its own slop; a press moved that far can never also become a hold.
	it("a push the hand already fisted for never brings the loupe, even if the map never panned", () => {
		r.map().fire("touchstart", touch("touchstart", [100, 100]));
		move(106, 100);
		vi.advanceTimersByTime(ACTIVATE_MS + HOLD_MS + 2000);
		expect(r.seed()).not.toHaveBeenCalled();
	});

	it("a second finger is a pinch, never a press", () => {
		r.map().fire("touchstart", touch("touchstart", [100, 100]));
		r.map().fire("touchstart", touch("touchstart", [100, 100], [200, 200]));
		vi.advanceTimersByTime(2000);
		expect(r.seed()).not.toHaveBeenCalled();
	});

	it("a second finger mid-hold cancels without committing", () => {
		r.map().fire("touchstart", touch("touchstart", [200, 300]));
		vi.advanceTimersByTime(ACTIVATE_MS + HOLD_MS - 50);
		r.map().fire("touchstart", touch("touchstart", [200, 300], [250, 350]));
		vi.advanceTimersByTime(2000);
		r.map().fire("touchend", touch("touchend"));
		expect(r.seed()).not.toHaveBeenCalled();
	});
});
