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

// A long-press's eventual click fires as a real tap unless swallowed at DOM capture. Window listener, not module state, so HMR duplication can't fork the flag.
// iOS yields no click after a long press, so the next pointerdown disarms it — never a timer, which a fast second tap beats and loses its click to.
function swallowNextClick(): void {
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

// Mouse and finger alike: a hold this long fires the ruler, so desktop rehearses exactly what the phone does.
export const HOLD_MS = 1200;
// The pointer holds the shovel handle; the hand's fingertip, up-left of it, is what clicks. = REACH in rapper's ShovelCursor.svelte.
const TIP_DX = -39;
const TIP_DY = -67;

export interface DoubleTapToPinOpts {
	/** Plant the first ruler node at the tap so it's immediately grabbable. */
	onMeasureSeed?: (lng: number, lat: number) => void;
	/** The tap here opens or dismisses something, so the hand stays hidden unless the press becomes a drag or a hold. */
	claimsTap?: (point: { x: number; y: number }) => boolean;
}

export function attachDoubleTapToPin(
	map: TapMap,
	opts: DoubleTapToPinOpts,
): () => void {
	map.doubleClickZoom.disable(); // dblclick drops a pin; pinch / two-finger zooms

	const onDbl = (e: MapMouseEvent) => {
		const c = map.getCanvas();
		const s = c.offsetWidth / c.getBoundingClientRect().width;
		const ll = map.unproject([e.point.x + TIP_DX * s, e.point.y + TIP_DY * s]);
		// ⛔ Not gated by DEBUG — without it "pin didn't drop" and "download failed" look identical.
		console.info(
			`[pin] 📍 double-tap at ${ll.lng.toFixed(5)}, ${ll.lat.toFixed(5)} — seeding`,
			{ handler: opts.onMeasureSeed ? "attached" : "MISSING (nothing will happen)" },
		);
		opts.onMeasureSeed?.(ll.lng, ll.lat);
		// The ruler's own hand takes over; ShovelCursor's would sit on top of it.
		emit("drop");
	};

	// The timer firing while the pointer is still down (never past slop) is itself the proof of "held + still".
	const SLOP_PX = 14;
	const DEBUG = false;
	const log = (...a: unknown[]) => {
		if (DEBUG) console.log("[snake-gesture]", ...a);
	};

	let pressStart: { x: number; y: number } | null = null;
	let isTouch = false;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	// Set while a hold is complete: the pointer can still slide, and lifting commits at the fingertip.
	let aim: { tip: { x: number; y: number } } | null = null;

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

	// ShovelCursor (rapper) fills its hold ring from these; a window event because a child can't import rapper's state.
	const emit = (phase: "arm" | "drag" | "end" | "aim" | "drop", x = 0, y = 0, extra = {}) =>
		window.dispatchEvent(new CustomEvent("gc-press", { detail: { phase, x, y, ms: HOLD_MS, ...extra } }));

	// The page is CSS-zoomed, so a viewport px is more than a canvas px.
	const toCanvas = (p: { x: number; y: number }): [number, number] => {
		const c = map.getCanvas();
		const r = c.getBoundingClientRect();
		const s = c.offsetWidth / r.width;
		return [(p.x - r.left) * s, (p.y - r.top) * s];
	};

	const aimAt = (finger: { x: number; y: number }) => {
		if (!aim) return;
		aim.tip = { x: finger.x + TIP_DX, y: finger.y + TIP_DY };
		const ll = map.unproject(toCanvas(aim.tip));
		emit("aim", aim.tip.x, aim.tip.y, { label: `${ll.lat.toFixed(3)}°, ${ll.lng.toFixed(3)}°` });
	};

	const startAim = () => {
		if (!pressStart) return;
		aim = { tip: pressStart };
		armReleaseSwallow();
		map.dragPan.disable();
		aimAt(pressStart);
	};

	const endAim = (commit: boolean) => {
		if (!aim) return;
		const tip = toCanvas(aim.tip);
		aim = null;
		map.dragPan.enable();
		emit("end");
		if (!commit) return;
		const ll = map.unproject(tip);
		opts.onMeasureSeed?.(ll.lng, ll.lat);
	};

	const killTimer = () => {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	};

	const fireLongPress = () => {
		pressTimer = null;
		log("✅ HOLD → arm out, aiming");
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
		pressStart = getClientCoords(oe);
		isTouch = isTouchLike(oe);
		killTimer();
		pressTimer = setTimeout(fireLongPress, HOLD_MS);
		emit("arm", pressStart.x, pressStart.y, { veiled: opts.claimsTap?.(e.point) ?? false });
		log("⬇️ down — timer armed", { isTouch, at: pressStart });
	};

	const cancelPress = (why: string) => {
		if (pressStart) log(`✖️ cancel (${why})`);
		if (pressTimer) emit(why === "drag past slop" ? "drag" : "end");
		endAim(false);
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
		endAim(true);
		cancelPress("pointer up");
	};

	const onMouseOut = () => cancelPress("mouseout");
	// iOS Safari fires contextmenu ~500 ms into a long press; swallow it so the hold runs on. Mapbox's own
	// dragstart is NOT a cancel either: it fires at 3 px, and a settling thumb moves that much — the slop above decides.
	const onContextMenu = (e: MapMouseEvent) => e.originalEvent?.preventDefault();
	const onTouchCancel = () => cancelPress("touchcancel");
	// ShovelCursor's lingering hand, held still on touch, plants the ruler at its fingertip.
	const onHandSeed = (e: Event) => {
		const ll = map.unproject(toCanvas((e as CustomEvent<{ x: number; y: number }>).detail));
		opts.onMeasureSeed?.(ll.lng, ll.lat);
	};

	map.on("dblclick", onDbl);
	map.on("mousedown", onDown);
	map.on("mouseup", onUp);
	map.on("mouseout", onMouseOut);
	map.on("contextmenu", onContextMenu);
	map.on("touchstart", onDown);
	map.on("touchend", onUp);
	map.on("touchcancel", onTouchCancel);
	window.addEventListener("mousemove", onMove, true);
	window.addEventListener("touchmove", onMove, true);
	window.addEventListener("gc-hand-seed", onHandSeed);

	return () => {
		map.off("dblclick", onDbl);
		map.off("mousedown", onDown);
		map.off("mouseup", onUp);
		map.off("mouseout", onMouseOut);
		map.off("contextmenu", onContextMenu);
		map.off("touchstart", onDown);
		map.off("touchend", onUp);
		window.removeEventListener("mousemove", onMove, true);
		window.removeEventListener("touchmove", onMove, true);
		window.removeEventListener("gc-hand-seed", onHandSeed);
		map.off("touchcancel", onTouchCancel);
		cancelPress("detach");
		disarmReleaseSwallow?.();
	};
}
