// On-screen touch log for a real phone, where emulation can't reproduce a gesture bug.
// Compiled in only when the build sets GC_TOUCH_DEBUG=1 (getCache/vite.config.ts), shown only with ?touchdebug.
declare const __TOUCH_DEBUG__: boolean;

const on =
	typeof __TOUCH_DEBUG__ !== "undefined" && __TOUCH_DEBUG__ && typeof location !== "undefined" && new URLSearchParams(location.search).has("touchdebug");

const lines: string[] = [];
let box: HTMLPreElement | null = null;

function show(line: string) {
	if (!box) {
		box = document.createElement("pre");
		Object.assign(box.style, {
			position: "fixed", top: "0", left: "0", right: "0", maxHeight: "45vh", overflow: "hidden", margin: "0", padding: "4px",
			font: "10px/1.25 ui-monospace, monospace", color: "#7f7", background: "rgba(0,0,0,0.8)", zIndex: "99999", pointerEvents: "none",
		});
		document.body.append(box);
	}
	lines.unshift(`${(performance.now() / 1000).toFixed(2)} ${line}`);
	lines.length = Math.min(lines.length, 22);
	const vv = window.visualViewport;
	box.textContent = `zoom ${vv?.scale.toFixed(2)} dpr ${devicePixelRatio} vvOffset ${Math.round(vv?.offsetLeft ?? 0)},${Math.round(vv?.offsetTop ?? 0)}\n${lines.join("\n")}`;
}

const where = (t: EventTarget | null) => {
	const e = t as Element | null;
	return e?.closest?.(".rt-measure-grab") ? "HAND" : e?.closest?.(".maplibregl-canvas-container") ? "map" : (e?.tagName?.toLowerCase() ?? "?");
};
const xy = (e: { clientX: number; clientY: number }) => `${Math.round(e.clientX)},${Math.round(e.clientY)}`;

if (on) {
	const opts = { capture: true, passive: true };
	for (const k of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
		addEventListener(k, (e) => { const p = e as PointerEvent; show(`${k} ${p.pointerType}#${p.pointerId} ${xy(p)} ${where(p.target)}`); }, opts);
	for (const k of ["touchstart", "touchmove", "touchend", "touchcancel"])
		addEventListener(k, (e) => { const t = e as TouchEvent; show(`${k} n=${t.touches.length} ${[...t.changedTouches].map((c) => `#${c.identifier}@${xy(c)}`).join(" ")} ${where(t.target)}`); }, opts);
	for (const k of ["mousedown", "mousemove", "mouseup"])
		addEventListener(k, (e) => show(`${k} ${xy(e as MouseEvent)} ${where(e.target)}`), opts);
}

export const touchLog = on ? show : undefined;
