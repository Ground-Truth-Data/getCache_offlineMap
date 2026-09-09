/**
 * Publishes the host's phone frame as CSS on :root — --dock-width-left/right,
 * the distance from each viewport edge to the frame, and --phone-frame-*, the
 * frame's own on-screen box. The frame is drawn by a transform (--fit), so its
 * on-screen edge can only be measured, not written. No frame on the page (a
 * bare standalone checkout) → nothing published, the lane CSS falls back to
 * its fixed band.
 */
const EDGE_GUTTER = 12;
const PHONE_GUTTER = 15;

export type FrameBox = {
	/** Gutter width from the left viewport edge to the frame, gutters removed. */
	left: number;
	/** Same, from the right edge. */
	right: number;
	frameLeft: number;
	frameTop: number;
	frameWidth: number;
	frameHeight: number;
};

export function publishDockWidths(
	frame: HTMLElement,
	onMeasure?: (box: FrameBox) => void,
): () => void {
	const root = document.documentElement.style;
	const apply = () => {
		const r = frame.getBoundingClientRect();
		const box: FrameBox = {
			left: Math.max(0, r.left - EDGE_GUTTER - PHONE_GUTTER),
			right: Math.max(0, window.innerWidth - r.right - EDGE_GUTTER - PHONE_GUTTER),
			frameLeft: r.left,
			frameTop: r.top,
			frameWidth: r.width,
			frameHeight: r.height,
		};
		root.setProperty("--dock-width-left", `${Math.round(box.left)}px`);
		root.setProperty("--dock-width-right", `${Math.round(box.right)}px`);
		root.setProperty("--phone-frame-left", `${Math.round(r.left)}px`);
		root.setProperty("--phone-frame-top", `${Math.round(r.top)}px`);
		root.setProperty("--phone-frame-width", `${Math.round(r.width)}px`);
		root.setProperty("--phone-frame-height", `${Math.round(r.height)}px`);
		onMeasure?.(box);
	};
	apply();
	const ro = new ResizeObserver(apply);
	ro.observe(frame);
	ro.observe(document.documentElement);
	window.addEventListener("resize", apply);
	return () => {
		ro.disconnect();
		window.removeEventListener("resize", apply);
		for (const p of [
			"--dock-width-left",
			"--dock-width-right",
			"--phone-frame-left",
			"--phone-frame-top",
			"--phone-frame-width",
			"--phone-frame-height",
		])
			root.removeProperty(p);
	};
}
