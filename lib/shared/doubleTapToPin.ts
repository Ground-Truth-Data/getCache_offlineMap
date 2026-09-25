/** Double-tap OR long-press → Snake Ruler, shared by the offline and online maps so the two never drift. */
import type { MapMouseEvent, MapTouchEvent, Point } from "mapbox-gl";

/** Both Mapbox and MapLibre satisfy this; on/off are loose because the two overload sets don't unify. */
type TapMap = {
	doubleClickZoom: { disable(): void };
	// biome-ignore lint/suspicious/noExplicitAny: two renderers, two overload sets
	on(type: string, listener: (e: any) => void): unknown;
	// biome-ignore lint/suspicious/noExplicitAny: mirrors `on`
	off(type: string, listener: (e: any) => void): unknown;
};

// A long-press's eventual click fires as a real tap unless swallowed at DOM capture. Window listener, not module state, so HMR duplication can't fork the flag.
function swallowNextClick(windowMs = 250): void {
	const kill = (e: MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		cleanup();
	};
	const cleanup = () => window.removeEventListener("click", kill, true);
	window.addEventListener("click", kill, true);
	// Expire fast, or a genuine later tap gets eaten.
	setTimeout(cleanup, windowMs);
}

export interface IdentifyResult {
	label: string;
	geometry?: GeoJSON.Geometry;
}

export interface DoubleTapToPinOpts {
	/** Return null when nothing can be named — the popover then shows only the GPS point. */
	identify?: (point: Point) => IdentifyResult | null | undefined;
	onSelect?: (geometry: GeoJSON.Geometry | null) => void;
	onDrop: (lng: number, lat: number) => void;
	/** Plant the first ruler node at the tap so it's immediately grabbable. */
	onMeasureSeed?: (lng: number, lat: number) => void;
	/** Call the dismiss fn the moment the tap turns into a ruler drag, or the card goes stale. */
	registerDismiss?: (dismiss: () => void) => void;
}

export function attachDoubleTapToPin(
	map: TapMap,
	opts: DoubleTapToPinOpts,
): () => void {
	map.doubleClickZoom.disable(); // dblclick drops a pin; pinch / two-finger zooms

	const teardown = () => opts.onSelect?.(null);
	opts.registerDismiss?.(teardown);

	const onDbl = (e: MapMouseEvent) => {
		teardown();
		const hit = opts.identify?.(e.point) ?? null;
		if (hit?.geometry) opts.onSelect?.(hit.geometry);
		// ⛔ Not gated by DEBUG — without it "pin didn't drop" and "download failed" look identical.
		console.info(
			`[pin] 📍 double-tap at ${e.lngLat.lng.toFixed(5)}, ${e.lngLat.lat.toFixed(5)} — seeding`,
			{ handler: opts.onMeasureSeed ? "attached" : "MISSING (nothing will happen)" },
		);
		opts.onMeasureSeed?.(e.lngLat.lng, e.lngLat.lat);
	};

	// The timer firing while the pointer is still down (never past slop) is itself the proof of "held + still".
	const LONG_PRESS_MS = 550;
	const MOUSE_SLOP_PX = 6;
	const TOUCH_SLOP_PX = 14;
	const DEBUG = false;
	const log = (...a: unknown[]) => {
		if (DEBUG) console.log("[snake-gesture]", ...a);
	};

	let pressStart: { x: number; y: number } | null = null;
	let pressLngLat: { lng: number; lat: number } | null = null;
	let pressPoint: Point | null = null;
	let isTouch = false;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let downAt = 0;

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

	const killTimer = () => {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	};

	const fireLongPress = () => {
		pressTimer = null;
		if (!pressLngLat) return;
		armReleaseSwallow();
		log("✅ LONG-PRESS fires → seed ruler", {
			heldMs: Math.round(performance.now() - downAt),
		});
		teardown();
		const hit = pressPoint ? (opts.identify?.(pressPoint) ?? null) : null;
		if (hit?.geometry) opts.onSelect?.(hit.geometry);
		opts.onMeasureSeed?.(pressLngLat.lng, pressLngLat.lat);
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
		pressStart = getClientCoords(oe);
		pressLngLat = e.lngLat;
		pressPoint = e.point;
		isTouch = isTouchLike(oe);
		downAt = performance.now();
		killTimer();
		pressTimer = setTimeout(fireLongPress, LONG_PRESS_MS);
		log("⬇️ down — timer armed", { isTouch, at: pressStart });
	};

	const cancelPress = (why: string) => {
		if (pressStart) log(`✖️ cancel (${why})`);
		killTimer();
		pressStart = null;
		pressLngLat = null;
		pressPoint = null;
	};

	const onMove = (e: MapMouseEvent | MapTouchEvent) => {
		if (!pressStart || !pressTimer) return;
		const coords = getClientCoords(e.originalEvent);
		const dist = Math.hypot(coords.x - pressStart.x, coords.y - pressStart.y);
		const slop = isTouch ? TOUCH_SLOP_PX : MOUSE_SLOP_PX;
		if (dist > slop) {
			log("↔️ move past slop → DRAG, not press", {
				dist: Math.round(dist),
				slop,
			});
			cancelPress("drag past slop");
		}
	};

	const onUp = () => {
		if (pressTimer)
			log("⬆️ up before timer → CLICK (no seed)", {
				heldMs: Math.round(performance.now() - downAt),
			});
		cancelPress("pointer up");
	};

	const onMouseOut = () => cancelPress("mouseout");
	const onDragStart = () => cancelPress("map dragstart");
	const onContextMenu = () => cancelPress("contextmenu");
	const onTouchCancel = () => cancelPress("touchcancel");

	map.on("dblclick", onDbl);
	map.on("mousedown", onDown);
	map.on("mousemove", onMove);
	map.on("mouseup", onUp);
	map.on("mouseout", onMouseOut);
	map.on("dragstart", onDragStart);
	map.on("contextmenu", onContextMenu);
	map.on("touchstart", onDown);
	map.on("touchmove", onMove);
	map.on("touchend", onUp);
	map.on("touchcancel", onTouchCancel);

	return () => {
		map.off("dblclick", onDbl);
		map.off("mousedown", onDown);
		map.off("mousemove", onMove);
		map.off("mouseup", onUp);
		map.off("mouseout", onMouseOut);
		map.off("dragstart", onDragStart);
		map.off("contextmenu", onContextMenu);
		map.off("touchstart", onDown);
		map.off("touchmove", onMove);
		map.off("touchend", onUp);
		map.off("touchcancel", onTouchCancel);
		cancelPress("detach");
		disarmReleaseSwallow?.();
		teardown();
	};
}
