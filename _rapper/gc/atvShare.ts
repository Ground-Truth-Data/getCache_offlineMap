/**
 * atvShare — the gold ATV ("share quad") that drives out from behind a
 * share/export button.
 *
 * The trick: the play-once WebP strip is cropped so it contains ONLY the
 * ATV + dust (the painted "Export Cache" button in the source frames is cut
 * away entirely). The strip rides on its own full-stage layer at Z_HANDS —
 * the same tier and the same home (phone frame on dt-web, <body> on a
 * device) as the teaching / celebration hands, so it paints over sheets,
 * popovers and toasts instead of dying inside whatever drawer the button
 * sits in. A hole the size of the button is punched out of that layer, its
 * cut edge tucked under the button by the button's own corner radius + 2px —
 * so the real button IS the mask, whatever its shape. Buttons shorter than
 * MIN_H get an oversized ATV whose cut edge is feathered with a gradient
 * mask (reads as dust, since the oversize strip pokes past the button's
 * silhouette).
 *
 * Direction is AUTO by runway: if there's ANY room to the button's right,
 * the quad exits right; only a button hugging the right edge sends it left.
 * `"left"` / `"right"` remain as explicit overrides.
 *
 * Use `playAtvShare(btn)` imperatively (SharePicker calls it on format
 * choose), or `use:atvShare` on any direct-share button.
 */

import { localFrom } from "./fixedContainingBlock.js";
import { frameFor } from "./handPortal";
import { Z_HANDS } from "./zTiers";
import { FILE_EXPORTED_EVENT } from "./fileEvents.js";

const MIN_H = 36; // px — floor so tiny icon buttons still throw a visible ATV
// "Any room at all on the right → go right." One quad-length of visible
// runway is the floor below which right just reads as a glitch.
const MIN_RUNWAY = 48;

/**
 * ── The treadmill + polyline rig ────────────────────────────────────────
 * The ORIGINAL asset baked the travel into the frames: a 911px canvas where
 * each frame painted the quad further right. That made a straight line the
 * only possible path.
 *
 * `share_atv_tread_*.webp` is that same art, re-cut: frames 9–20 (the window
 * where the quad is fully on-canvas) cropped to a fixed 314×132 box
 * REGISTERED ON THE QUAD'S NOSE — not on the frame's ink bbox, because the
 * dust plume changes length every frame and would have made the quad jitter.
 * Result: the quad drives in place, wheels spinning, dust trailing, and CSS
 * owns 100% of the travel. It loops forever, so path length is free.
 *
 * Quads don't drive straight on a planting site — they pick around debris.
 * So the path is a random polyline: a short straight launch out from under
 * the button, then 1–5 turns, every segment still net-advancing toward the
 * exit edge. Duration is derived from the summed path length so the quad
 * holds the SAME ground speed no matter how twisty the route is.
 */
const SPRITE_W = 314; // treadmill canvas, px
const SPRITE_H = 132;
// Rear axle, in sprite px — a quad pivots about its back wheels, so this is
// the transform-origin. Measured off the gold-body box (x 146–300, y 9–126).
const PIVOT_X = 175;
const PIVOT_Y = 100;
// Ground speed of the ORIGINAL clip, preserved exactly. The old strip moved
// the quad across its 911px canvas in 19 frames @ 58ms — but that canvas was
// SCALED to the button (height 132 → imgH), so the on-screen speed was
// 911 * scale px in 1.1s. Expressed per unit of scale, that is:
const SPEED_SPRITE_PX_PER_S = (911 / (19 * 58)) * 1000;
const LAUNCH_FRAC = 0.06; // straight run out from under the button
const MIN_LEG_FRAC = 0.15; // floor between turns — below this it reads as vibration
const MAX_TURN_DEG = 25; // per-turn swing; clamped so it never heads backwards
// Cumulative deviation cap. Kept well under 45° because the vertical drift of
// a long leg is len*sin(heading) — at 55° a final leg walks the quad clean
// off the top or bottom of the shell before it ever reaches the side.
const MAX_HEADING_DEG = 30;
const SETTLE_MS = 120;

type Exit = "left" | "right" | "auto";

/**
 * The quad CONFIRMS an export — it must never fire before the file actually
 * left. Share buttons therefore ARM the quad (remember the origin button),
 * and the ride is triggered by `announceExport`'s FILE_EXPORTED_EVENT — the
 * same success wire that sets the ✓ and evokes the celebration arms. Flows
 * with detours (format picker → "export ALL?" confirm → filter drawer) get
 * this for free: no announce, no quad.
 */
let armed: { btn: HTMLElement; exit: Exit; at: number } | null = null;
let listenerInstalled = false;
const ARM_TTL_MS = 3 * 60_000; // a stale arm from an abandoned flow never rides
const RIDE_DELAY_MS = 200; // let closing sheets unmount + the origin unhide

export function armAtvShare(btn: HTMLElement, exit: Exit = "auto"): void {
	armed = { btn, exit, at: Date.now() };
	if (listenerInstalled || typeof window === "undefined") return;
	listenerInstalled = true;
	window.addEventListener(FILE_EXPORTED_EVENT, () => {
		const a = armed;
		armed = null;
		if (!a || Date.now() - a.at > ARM_TTL_MS) return;
		setTimeout(() => {
			if (a.btn.isConnected) playAtvShare(a.btn, a.exit);
		}, RIDE_DELAY_MS);
	});
}

function resolveExit(btn: HTMLElement, exit: Exit): "left" | "right" {
	if (exit !== "auto") return exit;
	// Measure runway against the APP SHELL, not the browser viewport — in the
	// dt-web phone-frame preview the window is far wider than the app, and
	// window-based room would send every quad right. Same frame-local law as
	// the pointing hands.
	const host = btn.closest(".mobile-shell") ?? document.documentElement;
	// MIN_RUNWAY is a CSS-px constant, so the gap must be CSS px too — a raw
	// screen-px gap is compared against an effectively smaller threshold the
	// more dt-web scales the phone up, which flips the exit direction.
	const { k } = localFrom(btn);
	const roomRight =
		(host.getBoundingClientRect().right - btn.getBoundingClientRect().right) / k;
	return roomRight >= MIN_RUNWAY ? "right" : "left";
}

type Leg = { x: number; y: number; heading: number; len: number };

/**
 * Build the random route. Distances come in as fractions of `run` (the
 * straight-line distance the quad must cover to clear the viewport), so a
 * 40px icon button and a full-width bar get the same-shaped ride.
 *
 * `sign` is +1 driving right, -1 driving left. Headings are in the quad's
 * own frame — 0 = straight ahead — so the same maths serves both directions
 * and only the final transform flips.
 */
function buildRoute(run: number, drift: number): Leg[] {
	const legs: Leg[] = [];
	let x = 0;
	let y = 0;
	let heading = 0;

	// Launch on a RANDOM heading, not straight. If the launch were straight,
	// a 1-turn route would have its single turn cancelled by the homing exit
	// leg below and ~1 ride in 5 would drive in a dead straight line — the
	// exact thing this rig exists to stop.
	heading = (Math.random() * 2 - 1) * MAX_TURN_DEG;
	const launch = run * LAUNCH_FRAC;
	const lrad = (heading * Math.PI) / 180;
	x += Math.cos(lrad) * launch;
	y += Math.sin(lrad) * launch;
	legs.push({ x, y, heading, len: launch });

	// 1–5 turns INCLUDING the one that sets up the final exit leg, so the
	// visible count matches the spec rather than overshooting by one.
	const turns = 1 + Math.floor(Math.random() * 5);
	const minLeg = run * MIN_LEG_FRAC;

	for (let i = 0; i < turns - 1; i++) {
		const forwardLeft = run - x;
		if (forwardLeft <= minLeg) break;

		// Turn first, then drive the new heading. Steer back toward centre
		// when the quad is running out of vertical room, so the drift cap is
		// respected by AIM rather than by a hard clamp that would show up as
		// the quad visibly sliding along an invisible wall.
		const swing = (Math.random() * 2 - 1) * MAX_TURN_DEG;
		const room = drift > 0 ? y / drift : 0; // -1..1, how close to the edge
		heading = Math.max(
			-MAX_HEADING_DEG,
			Math.min(MAX_HEADING_DEG, heading + swing - room * MAX_TURN_DEG),
		);

		const maxLeg = forwardLeft / Math.max(1, turns - i);
		let len = Math.max(minLeg, maxLeg * (0.6 + Math.random() * 0.6));

		// Never let a single leg punch through the vertical budget.
		const rad = (heading * Math.PI) / 180;
		const dy = Math.sin(rad);
		if (drift > 0 && Math.abs(dy) > 0.01) {
			const room2 = dy > 0 ? drift - y : -drift - y;
			len = Math.min(len, Math.abs(room2 / dy));
		}
		if (len < 1) break;

		x += Math.cos(rad) * len;
		y += dy * len;
		legs.push({ x, y, heading, len });
	}

	// Final leg: whatever it takes to actually clear the edge, on a heading
	// aimed back toward the button's own vertical line. Without this a short
	// random route could strand the quad mid-screen — it must always leave.
	const forwardLeft = run - x;
	if (forwardLeft > 0) {
		// Aim the exit so it sheds MOST of the accumulated drift — but only
		// most. Homing exactly to y=0 would straighten the ride out just as
		// it leaves; leaving a share of the offset keeps the quad angling off
		// the edge the way it was travelling.
		heading = Math.max(
			-MAX_HEADING_DEG,
			Math.min(
				MAX_HEADING_DEG,
				(Math.atan2(-y * 0.6, forwardLeft) * 180) / Math.PI,
			),
		);
		const rad = (heading * Math.PI) / 180;
		const len = forwardLeft / Math.max(0.3, Math.cos(rad));
		x += Math.cos(rad) * len;
		y += Math.sin(rad) * len;
		legs.push({ x, y, heading, len });
	}

	return legs;
}

export function playAtvShare(btn: HTMLElement, exit: Exit = "auto"): void {
	// Deliberately NOT gated on prefers-reduced-motion: the quad is the app's
	// share signature, plays once, and the guard silently killed it on every
	// Mac with Reduce Motion on (including the author's).
	const dir = resolveExit(btn, exit);

	// Home = the hands' home (handPortal): the phone frame on dt-web, whose
	// `contain: layout` makes it the containing block for the fixed layer and
	// whose overflow:hidden clips the ride to the bezel; <body> on a device,
	// where fixed resolves to the viewport.
	const home = frameFor(btn) ?? document.body;
	const hr = home.getBoundingClientRect();
	// ONE COORDINATE SPACE — the home's own CSS px. Rects come back in screen
	// px and dt-web scales the phone by --fit, so every measurement is divided
	// by k on the way in (same conversion as Player.svelte's place()).
	const inFrame = home !== document.body;
	const k = inFrame && home.offsetWidth > 0 ? hr.width / home.offsetWidth : 1;
	const hcs = getComputedStyle(home);
	const originX = inFrame
		? hr.left + (Number.parseFloat(hcs.borderLeftWidth) || 0) * k
		: 0;
	const originY = inFrame
		? hr.top + (Number.parseFloat(hcs.borderTopWidth) || 0) * k
		: 0;
	const toLocalX = (screenX: number) => (screenX - originX) / k;
	const toLocalY = (screenY: number) => (screenY - originY) / k;

	const h = btn.offsetHeight;
	if (!h) return;
	const w = btn.offsetWidth;
	const btnRect = btn.getBoundingClientRect();
	const bx = toLocalX(btnRect.left);
	const by = toLocalY(btnRect.top);
	const bcs = getComputedStyle(btn);
	const rRaw =
		Number.parseFloat(
			dir === "left" ? bcs.borderTopLeftRadius : bcs.borderTopRightRadius,
		) || 0;
	const overlap = Math.min(rRaw, h / 2) + 2;
	const imgH = Math.max(h * 1.05, MIN_H);
	const scale = imgH / SPRITE_H;

	type AtvHost = HTMLElement & { __atvLayer?: HTMLElement | null };
	(btn as AtvHost).__atvLayer?.remove();

	// The layer is the stage: full home box, above everything at Z_HANDS, with
	// the button's rect punched out (two mask layers, composited exclude) so
	// the quad starts hidden UNDER the button and drives out of it. Both the
	// -webkit- and standard mask properties are written: WebKit needs the
	// prefix, Chrome < 120 ignored the unprefixed composite.
	const layer = document.createElement("div");
	(btn as AtvHost).__atvLayer = layer;
	layer.setAttribute("aria-hidden", "true");
	const maskImg = "linear-gradient(#000 0 0), linear-gradient(#000 0 0)";
	const maskSize = `100% 100%, ${w}px ${h}px`;
	const maskPos = `0 0, ${bx}px ${by}px`;
	layer.style.cssText = [
		"position:fixed",
		"inset:0",
		"overflow:hidden",
		"pointer-events:none",
		`z-index:${Z_HANDS}`,
		`-webkit-mask-image:${maskImg}`,
		`mask-image:${maskImg}`,
		`-webkit-mask-size:${maskSize}`,
		`mask-size:${maskSize}`,
		`-webkit-mask-position:${maskPos}`,
		`mask-position:${maskPos}`,
		"-webkit-mask-repeat:no-repeat",
		"mask-repeat:no-repeat",
		"-webkit-mask-composite:xor",
		"mask-composite:exclude",
	].join(";");

	const img = new Image();
	img.alt = "";
	img.setAttribute("aria-hidden", "true");
	// The treadmill loops forever (loop=0), so no cache-buster is needed —
	// the old strip was loop=1 and a reused URL would have shown its spent
	// final frame. Dropping the buster also lets the browser cache it.
	img.src =
		dir === "left"
			? "/mobileAssets/share_atv_tread_left.webp"
			: "/mobileAssets/share_atv_tread_right.webp";

	// The quad's nose sits at the sprite's right edge (left edge when
	// mirrored). Park that nose at the button's edge, tucked under by the
	// corner radius, and let the transform do everything from there.
	const st = img.style;
	st.position = "absolute";
	st.pointerEvents = "none";
	st.height = `${imgH}px`;
	st.width = `${SPRITE_W * scale}px`;
	st.maxWidth = "none";
	st.top = `${by + h / 2 - imgH / 2}px`;
	st.left =
		dir === "left"
			? `${bx + overlap}px`
			: `${bx + w - overlap - SPRITE_W * scale}px`;
	// Rotate about the rear axle — where a real quad pivots. Mirrored art
	// mirrors the pivot too.
	const pvx = dir === "left" ? SPRITE_W - PIVOT_X : PIVOT_X;
	st.transformOrigin = `${pvx * scale}px ${PIVOT_Y * scale}px`;
	// Feather the cut edge on oversized strips so it reads as dust, not a
	// hard crop, while the quad is still tucked under a short button.
	if (imgH > h * 1.05) {
		const m = `linear-gradient(to ${dir}, transparent 2px, #000 14px)`;
		st.webkitMaskImage = m;
		st.maskImage = m;
	}

	// Runway: how far the quad must travel to fully clear the app shell.
	const host = btn.closest(".mobile-shell") ?? document.documentElement;
	const hostRect = host.getBoundingClientRect();
	const run =
		(dir === "right"
			? hostRect.right - btnRect.right
			: btnRect.left - hostRect.left) /
			k +
		SPRITE_W * scale;

	// Vertical headroom: the quad must not leave through the TOP or BOTTOM.
	// Whatever room it has above/below the button caps how far it may drift.
	const driftUp = (btnRect.top - hostRect.top) / k;
	const driftDown = (hostRect.bottom - btnRect.bottom) / k;

	const legs = buildRoute(run, Math.max(0, Math.min(driftUp, driftDown)));
	const total = legs.reduce((s, l) => s + l.len, 0);
	// Speed is preserved by converting the path (CSS px) back into sprite px
	// before dividing — the same space the original clip's speed was measured
	// in. Mixing the two is what made the first cut of this ride 4× too fast.
	const durMs = (total / scale / SPEED_SPRITE_PX_PER_S) * 1000;

	// One keyframe per waypoint. `sx` flips the advancing axis for a
	// left-bound quad; `sy` flips the turn direction with it so a "left
	// turn" stays visually left in both mirrorings.
	const sx = dir === "left" ? -1 : 1;
	let acc = 0;
	const frames = [
		{ offset: 0, transform: "translate(0px, 0px) rotate(0deg)" },
		...legs.map((l) => {
			acc += l.len;
			return {
				offset: Math.min(1, acc / total),
				transform: `translate(${sx * l.x}px, ${l.y}px) rotate(${sx * l.heading}deg)`,
			};
		}),
	];

	layer.appendChild(img);
	home.appendChild(layer);

	// Linear easing throughout: a quad picking its way round debris doesn't
	// accelerate out of every corner, and constant speed is the whole point
	// of deriving duration from path length.
	const anim = img.animate(frames, {
		duration: durMs,
		easing: "linear",
		fill: "forwards",
	});

	const cleanup = () => {
		layer.remove();
		if ((btn as AtvHost).__atvLayer === layer)
			(btn as AtvHost).__atvLayer = null;
	};
	anim.addEventListener("finish", () => setTimeout(cleanup, SETTLE_MS));
	// Belt-and-braces: a backgrounded tab can freeze the WAAPI clock and the
	// `finish` event never lands, which would leave the sprite parked on the
	// button forever. Same frozen-clock trap the waapiWatchdog exists for.
	setTimeout(cleanup, durMs + SETTLE_MS + 1500);
}

/** Svelte action: `<button use:atvShare>` ARMS the quad on tap; the ride
 *  fires only when the export success event lands. `{{ exit }}` overrides auto. */
export function atvShare(node: HTMLElement, opts?: { exit?: Exit }) {
	let exit: Exit = opts?.exit ?? "auto";
	const onClick = () => armAtvShare(node, exit);
	node.addEventListener("click", onClick);
	return {
		update(next?: { exit?: Exit }) {
			exit = next?.exit ?? "auto";
		},
		destroy() {
			node.removeEventListener("click", onClick);
		},
	};
}
