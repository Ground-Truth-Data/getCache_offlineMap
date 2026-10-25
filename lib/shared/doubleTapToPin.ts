/** Double-tap OR long-press → Snake Ruler, shared by the offline and online maps so the two never drift. */
import type { MapMouseEvent, MapTouchEvent } from "mapbox-gl";

/** Both Mapbox and MapLibre satisfy this; on/off are loose because the two overload sets don't unify. */
type TapMap = {
	doubleClickZoom: { disable(): void };
	dragPan: { enable(): void; disable(): void };
	getCanvas(): HTMLCanvasElement;
	unproject(p: [number, number]): { lng: number; lat: number };
	// biome-ignore lint/suspicious/noExplicitAny: two renderers, two overload sets
	on(type: string, listener: (e: any) => void): unknown;
	// biome-ignore lint/suspicious/noExplicitAny: mirrors `on`
	off(type: string, listener: (e: any) => void): unknown;
};

// The click after a long-press or a hand drag fires as a real tap unless swallowed at DOM capture. Window listener, not module state, so HMR duplication can't fork the flag.
// iOS yields no click after a long press, so the next pointerdown disarms it — never a timer, which a fast second tap beats and loses its click to.
export function swallowNextClick(): void {
	const kill = (e: MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		cleanup();
	};
	const cleanup = () => {
		window.removeEventListener("click", kill, true);
		window.removeEventListener("pointerdown", cleanup, true);
	};
	window.addEventListener("click", kill, true);
	window.addEventListener("pointerdown", cleanup, true);
}

// Mouse and finger alike, so desktop rehearses exactly what the phone does. A press held this long brings
// up the loupe; once the pointer has rested HOLD_MS the ruler seeds there, finger still down or not.
export const ACTIVATE_MS = 260;
export const HOLD_MS = 900;
// Before the loupe, a move past this is a pan. After it, a move past this restarts the rest.
const SLOP_PX = 8;
const STILL_PX = 4;

/** ShovelCursor (rapper) draws the hand and the loupe from these; a window event because a child can't import rapper's state. */
export const emit = (phase: "arm" | "drag" | "end" | "aim" | "drop", x = 0, y = 0, extra = {}) =>
	window.dispatchEvent(new CustomEvent("gc-press", { detail: { phase, x, y, ms: HOLD_MS, ...extra } }));

export const coordLabel = (lng: number, lat: number) => `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;

export interface DoubleTapToPinOpts {
	/** Plant the first ruler node at the tap so it's immediately grabbable. */
	onMeasureSeed?: (lng: number, lat: number) => void;
	/** The tap here opens or dismisses something, so the hand stays hidden unless the press becomes a drag or a hold. */
	claimsTap?: (point: { x: number; y: number }) => boolean;
	/** False while another tool owns the map (a ruler open, a palette tool armed, corners being edited): a press then only pans, with no hold and no count. */
	canSeed?: () => boolean;
}

export function attachDoubleTapToPin(
	map: TapMap,
	opts: DoubleTapToPinOpts,
): () => void {
	map.doubleClickZoom.disable(); // dblclick drops a pin; pinch / two-finger zooms

	const onDbl = (e: MapMouseEvent) => {
		if (opts.canSeed?.() === false) return;
		const { lng, lat } = e.lngLat;
		// ⛔ Not gated by DEBUG — without it "pin didn't drop" and "download failed" look identical.
		console.info(`[pin] 📍 double-tap at ${lng.toFixed(5)}, ${lat.toFixed(5)} — seeding`, {
			handler: opts.onMeasureSeed ? "attached" : "MISSING (nothing will happen)",
		});
		opts.onMeasureSeed?.(lng, lat);
		emit("drop");
	};

	const DEBUG = false;
	const log = (...a: unknown[]) => {
		if (DEBUG) console.log("[snake-gesture]", ...a);
	};

	let pressStart: { x: number; y: number } | null = null;
	let isTouch = false;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	// Set while the loupe is up: where the pointer is, and where and when it last came to rest.
	let aim: { at: { x: number; y: number }; anchor: { x: number; y: number }; since: number } | null = null;

	// Arm on the raw DOM release, not the map's mouseup — seeding mounts DOM under the held pointer, which fires mouseout and wipes the bookkeeping first.
	let disarmReleaseSwallow: (() => void) | null = null;
	const armReleaseSwallow = () => {
		disarmReleaseSwallow?.();
		const evtName = isTouch ? "touchend" : "mouseup";
		const onRelease = () => {
			disarmReleaseSwallow = null;
			swallowNextClick();
			log("⬆️ release after long-press → swallowing its click");
		};
		window.addEventListener(evtName, onRelease, { capture: true, once: true });
		disarmReleaseSwallow = () => {
			window.removeEventListener(evtName, onRelease, true);
			disarmReleaseSwallow = null;
		};
	};

	// The page is CSS-zoomed, so a viewport px is more than a canvas px.
	const toCanvas = (p: { x: number; y: number }): [number, number] => {
		const c = map.getCanvas();
		const r = c.getBoundingClientRect();
		const s = c.offsetWidth / r.width;
		return [(p.x - r.left) * s, (p.y - r.top) * s];
	};

	// A finger left down after the seed does nothing: the hand under it is the ruler's, and a pan
	// needs a fresh press.
	let lockTimer: ReturnType<typeof setTimeout> | null = null;
	const lock = () => {
		lockTimer = null;
		if (!aim) return;
		const at = toCanvas(aim.at);
		aim = null;
		map.dragPan.enable();
		emit("end", 0, 0, { locked: true });
		const ll = map.unproject(at);
		opts.onMeasureSeed?.(ll.lng, ll.lat);
	};
	const rest = () => {
		if (lockTimer) clearTimeout(lockTimer);
		lockTimer = setTimeout(lock, HOLD_MS);
		return performance.now();
	};

	const aimAt = (at: { x: number; y: number }) => {
		if (!aim) return;
		aim.at = at;
		if (Math.hypot(at.x - aim.anchor.x, at.y - aim.anchor.y) > STILL_PX) {
			aim.anchor = at;
			aim.since = rest();
		}
		const ll = map.unproject(toCanvas(at));
		emit("aim", at.x, at.y, { canvas: map.getCanvas(), since: aim.since, label: coordLabel(ll.lng, ll.lat) });
	};

	const startAim = () => {
		if (!pressStart) return;
		aim = { at: pressStart, anchor: pressStart, since: rest() };
		armReleaseSwallow();
		map.dragPan.disable();
		aimAt(pressStart);
	};

	const endAim = () => {
		if (lockTimer) clearTimeout(lockTimer);
		lockTimer = null;
		if (!aim) return;
		aim = null;
		map.dragPan.enable();
		emit("end");
	};

	const killTimer = () => {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	};

	const fireLongPress = () => {
		pressTimer = null;
		log("✅ HOLD → loupe up");
		startAim();
	};

	// Desktop Safari has no TouchEvent — `instanceof TouchEvent` throws, so duck-type.
	const isTouchLike = (
		evt: MouseEvent | TouchEvent,
	): evt is TouchEvent => "touches" in evt;

	const getClientCoords = (evt: MouseEvent | TouchEvent) => {
		if (isTouchLike(evt) && evt.touches.length > 0) {
			return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
		}
		return { x: (evt as MouseEvent).clientX, y: (evt as MouseEvent).clientY };
	};

	const onDown = (e: MapMouseEvent | MapTouchEvent) => {
		const oe = e.originalEvent;
		if (oe instanceof MouseEvent && oe.button !== 0) return;
		if (isTouchLike(oe) && oe.touches.length > 1) return cancelPress("second finger");
		// A marker (a ruler hand, a pin) is its own handle; Mapbox still reports the press as the map's.
		if ((oe.target as Element | null)?.closest?.(".mapboxgl-marker, .maplibregl-marker")) return;
		// A layer that took the press (the route line, being pulled) owns it; it attaches before us, so its handler ran first.
		if (e.defaultPrevented) return;
		if (opts.canSeed?.() === false) return;
		pressStart = getClientCoords(oe);
		isTouch = isTouchLike(oe);
		killTimer();
		pressTimer = setTimeout(fireLongPress, ACTIVATE_MS);
		emit("arm", pressStart.x, pressStart.y, { veiled: opts.claimsTap?.(e.point) ?? false });
		log("⬇️ down — timer armed", { isTouch, at: pressStart });
	};

	const cancelPress = (why: string) => {
		if (pressStart) log(`✖️ cancel (${why})`);
		if (pressTimer) emit(why === "drag past slop" ? "drag" : "end");
		endAim();
		killTimer();
		pressStart = null;
	};

	// Raw window events, not the map's: Mapbox mutes its mousemove the moment its pan takes over (3 px),
	// which is before the slop, so a map-fed check never hears a drag and the timer fires mid-pan.
	const onMove = (evt: MouseEvent | TouchEvent) => {
		if (aim && (!isTouchLike(evt) || evt.touches.length === 1)) return aimAt(getClientCoords(evt));
		if (!pressStart || !pressTimer) return;
		const coords = getClientCoords(evt);
		const dist = Math.hypot(coords.x - pressStart.x, coords.y - pressStart.y);
		if (dist > SLOP_PX) {
			log("↔️ move past slop → DRAG, not press", { dist: Math.round(dist) });
			cancelPress("drag past slop");
		}
	};

	const onUp = () => {
		if (pressTimer) log("⬆️ up before timer → CLICK (no seed)");
		cancelPress("pointer up");
	};

	const onMouseOut = () => cancelPress("mouseout");
	// Mapbox's own dragstart is NOT a cancel: it fires at 3 px, and a settling thumb moves that much — the slop above decides.
	const onTouchCancel = () => cancelPress("touchcancel");

	map.on("dblclick", onDbl);
	map.on("mousedown", onDown);
	map.on("mouseup", onUp);
	map.on("mouseout", onMouseOut);
	map.on("touchstart", onDown);
	map.on("touchend", onUp);
	map.on("touchcancel", onTouchCancel);
	window.addEventListener("mousemove", onMove, true);
	window.addEventListener("touchmove", onMove, true);

	return () => {
		map.off("dblclick", onDbl);
		map.off("mousedown", onDown);
		map.off("mouseup", onUp);
		map.off("mouseout", onMouseOut);
		map.off("touchstart", onDown);
		map.off("touchend", onUp);
		window.removeEventListener("mousemove", onMove, true);
		window.removeEventListener("touchmove", onMove, true);
		map.off("touchcancel", onTouchCancel);
		cancelPress("detach");
		disarmReleaseSwallow?.();
	};
}
