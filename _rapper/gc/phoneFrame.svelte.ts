/**
 * The phone frame as a measured fact: the layout draws it after a page's
 * onMount and only on some routes, so neither a media query nor a mount-time
 * querySelector can answer. `null` = no frame.
 */
import { publishDockWidths, type FrameBox } from "$rig/dev/dockWidths";

export type { FrameBox };

export function watchPhoneFrame(onChange: (box: FrameBox | null) => void): () => void {
	let stopWidths: (() => void) | undefined;
	let current: HTMLElement | null = null;
	// Kept apart from `current`: "not looked yet" and "looked, no frame" are
	// both null, and a caller waiting for its first answer would wait forever.
	let reported = false;

	const sync = () => {
		const frame = document.querySelector<HTMLElement>(".mobile-preview-frame");
		if (reported && frame === current) return;
		reported = true;
		stopWidths?.();
		stopWidths = undefined;
		current = frame;
		if (frame) stopWidths = publishDockWidths(frame, onChange);
		else onChange(null);
	};

	sync();
	const mo = new MutationObserver(sync);
	mo.observe(document.body, { childList: true, subtree: true });
	return () => {
		mo.disconnect();
		stopWidths?.();
	};
}
