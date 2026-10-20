/** ATV sprite rides its own layer at Z_HANDS with the button's rect masked out. */

import { localFrom } from "./fixedContainingBlock.js";
import { frameFor } from "./handPortal";
import { Z_HANDS } from "./zTiers";
import { FILE_EXPORTED_EVENT } from "./fileEvents.js";

const MIN_H = 36; // px floor so tiny icon buttons still throw a visible ATV
const MIN_RUNWAY = 48; // one quad-length; less and exiting right reads as a glitch

// Sprite treadmills in place; CSS drives the polyline. Duration derives from
// path length so ground speed is constant however twisty.
const SPRITE_W = 314;
const SPRITE_H = 132;
// Rear axle in sprite px: a quad pivots about its back wheels.
const PIVOT_X = 175;
const PIVOT_Y = 100;
// Ground speed of the source clip: 911px canvas in 19 frames @ 58ms, per unit of scale.
const SPEED_SPRITE_PX_PER_S = (911 / (19 * 58)) * 1000;
const LAUNCH_FRAC = 0.06; // straight run out from under the button
const MIN_LEG_FRAC = 0.15; // below this a leg reads as vibration
const MAX_TURN_DEG = 25;
// Kept well under 45°: at 55° a leg's vertical drift (len*sin) walks the quad off-frame first.
const MAX_HEADING_DEG = 30;
const SETTLE_MS = 120;

type Exit = "left" | "right" | "auto";

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
	// Runway against .mobile-shell, not the viewport (dt-web's preview is wider than the
	// app), in CSS px along the PAGE's right — turned a quarter turn, screen-right is wrong.
	const host = btn.closest(".mobile-shell") ?? document.documentElement;
	const { point } = localFrom(btn);
	const hr = host.getBoundingClientRect();
	const br = btn.getBoundingClientRect();
	const hostXs = [
		point(hr.left, hr.top).x,
		point(hr.right, hr.bottom).x,
	];
	const btnXs = [point(br.left, br.top).x, point(br.right, br.bottom).x];
	const roomRight = Math.max(...hostXs) - Math.max(...btnXs);
	return roomRight >= MIN_RUNWAY ? "right" : "left";
}

type Leg = { x: number; y: number; heading: number; len: number };

/** Route in fractions of `run`, so a 40px icon and a full-width bar ride the same shape. */
function buildRoute(run: number, drift: number): Leg[] {
	const legs: Leg[] = [];
	let x = 0;
	let y = 0;
	let heading = 0;

	// A 1-turn route has its only turn cancelled by the homing exit leg, so ~1/5 rides straight.
	heading = (Math.random() * 2 - 1) * MAX_TURN_DEG;
	const launch = run * LAUNCH_FRAC;
	const lrad = (heading * Math.PI) / 180;
	x += Math.cos(lrad) * launch;
	y += Math.sin(lrad) * launch;
	legs.push({ x, y, heading, len: launch });

	const turns = 1 + Math.floor(Math.random() * 5);
	const minLeg = run * MIN_LEG_FRAC;

	for (let i = 0; i < turns - 1; i++) {
		const forwardLeft = run - x;
		if (forwardLeft <= minLeg) break;

		// A hard clamp here reads as the quad sliding along an invisible wall.
		const swing = (Math.random() * 2 - 1) * MAX_TURN_DEG;
		const room = drift > 0 ? y / drift : 0;
		heading = Math.max(
			-MAX_HEADING_DEG,
			Math.min(MAX_HEADING_DEG, heading + swing - room * MAX_TURN_DEG),
		);

		const maxLeg = forwardLeft / Math.max(1, turns - i);
		let len = Math.max(minLeg, maxLeg * (0.6 + Math.random() * 0.6));

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

	// Homes toward y=0 to shed drift, so the ride straightens just as it exits.
	const forwardLeft = run - x;
	if (forwardLeft > 0) {
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
	// Not gated on prefers-reduced-motion: that guard killed the share signature on every Mac with Reduce Motion on.
	const dir = resolveExit(btn, exit);

	// All distances go through point(): a raw rect/offsetWidth divide reads aspect ratio, not scale, once turned.
	// Home is the frame, never the button's own containing block: a transformed card clips the ride to itself.
	const home = frameFor(btn) ?? document.body;
	const layer = document.createElement("div");
	home.appendChild(layer);
	const { point } = localFrom(layer);

	const h = btn.offsetHeight;
	if (!h) return layer.remove();
	const w = btn.offsetWidth;
	const btnRect = btn.getBoundingClientRect();
	const { x: bx, y: by } = point(btnRect.left, btnRect.top);
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

	// Full-home layer masks out the button's rect (composited exclude) so the quad starts under it.
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
	img.src =
		dir === "left"
			? "/mobileAssets/share_atv_tread_left.webp"
			: "/mobileAssets/share_atv_tread_right.webp";

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
	const pvx = dir === "left" ? SPRITE_W - PIVOT_X : PIVOT_X;
	st.transformOrigin = `${pvx * scale}px ${PIVOT_Y * scale}px`;
	// Feather the cut edge on oversized strips so it reads as dust, not a crop.
	if (imgH > h * 1.05) {
		const m = `linear-gradient(to ${dir}, transparent 2px, #000 14px)`;
		st.webkitMaskImage = m;
		st.maskImage = m;
	}

	// Shell edges go through point() too: turned, "right of the button" can be the gap below it.
	const host = btn.closest(".mobile-shell") ?? document.documentElement;
	const hostRect = host.getBoundingClientRect();
	const a = point(hostRect.left, hostRect.top);
	const b = point(hostRect.right, hostRect.bottom);
	const hostLeft = Math.min(a.x, b.x);
	const hostRight = Math.max(a.x, b.x);
	const hostTop = Math.min(a.y, b.y);
	const hostBottom = Math.max(a.y, b.y);
	const run =
		(dir === "right" ? hostRight - (bx + w) : bx - hostLeft) +
		SPRITE_W * scale;

	const driftUp = by - hostTop;
	const driftDown = hostBottom - (by + h);

	const legs = buildRoute(run, Math.max(0, Math.min(driftUp, driftDown)));
	layer.appendChild(img);
	drive(img, legs, scale, dir === "left" ? -1 : 1, () => {
		layer.remove();
		if ((btn as AtvHost).__atvLayer === layer)
			(btn as AtvHost).__atvLayer = null;
	});
}

// A turn is centred on its corner, so the quad is halfway round as it bounces.
const TURN_S = 1;

/** `sx` flips both the advancing axis and the turn direction for a left-bound quad. */
function drive(img: HTMLImageElement, legs: Leg[], scale: number, sx: 1 | -1, cleanup: () => void) {
	const total = legs.reduce((s, l) => s + l.len, 0);
	// Divide in sprite px, the space the clip's speed was measured in.
	const durMs = (total / scale / SPEED_SPRITE_PX_PER_S) * 1000;
	const leadPx = (TURN_S / 2) * SPEED_SPRITE_PX_PER_S * scale;
	const deg = (h: number) => `${sx * h}deg`;
	const moves: Keyframe[] = [{ offset: 0, translate: "0px 0px" }];
	const turns: Keyframe[] = [{ offset: 0, rotate: deg(legs[0]?.heading ?? 0) }];
	let acc = 0;
	legs.forEach((l, i) => {
		const next = legs[i + 1];
		if (next) {
			const lead = Math.min(leadPx, l.len / 2, next.len / 2);
			turns.push({ offset: (acc + l.len - lead) / total, rotate: deg(l.heading), easing: "ease-in-out" });
			turns.push({ offset: (acc + l.len + lead) / total, rotate: deg(next.heading) });
		}
		acc += l.len;
		moves.push({ offset: Math.min(1, acc / total), translate: `${sx * l.x}px ${l.y}px` });
	});
	turns.push({ offset: 1, rotate: deg(legs.at(-1)?.heading ?? 0) });

	// Two animations so the turn can ease without the quad's speed easing with it.
	const timing = { duration: durMs, easing: "linear", fill: "forwards" } as const;
	img.animate(turns, timing);
	const anim = img.animate(moves, timing);
	anim.addEventListener("finish", () => setTimeout(cleanup, SETTLE_MS));
	// A backgrounded tab freezes the WAAPI clock and `finish` never lands.
	setTimeout(cleanup, durMs + SETTLE_MS + 1500);
}

const ROAM_H = 48;
// Steep climbs and dives; any heading under 90° still only gains ground.
const ROAM_MIN_DEG = 20;
const ROAM_MAX_DEG = 60;
const ROAM_TURN_GAP_S = 1.3;
// A floor plus an exponential wait: never under a minute apart, eight on average.
const ROAM_FLOOR_MS = 60_000;
const ROAM_MEAN_EXTRA_MS = 7 * 60_000;

/** Zig-zag that only ever gains ground: legs alternate climb and dive, bouncing off the band's edges. */
function roamRoute(run: number, drift: number, minLeg: number): Leg[] {
	const legs: Leg[] = [];
	let x = 0;
	let y = 0;
	let up = Math.random() < 0.5;
	while (x < run) {
		const rad = ((ROAM_MIN_DEG + Math.random() * (ROAM_MAX_DEG - ROAM_MIN_DEG)) * Math.PI) / 180;
		// minLeg is along the slope; the entry leg may be shorter because it starts off-screen.
		let dx = minLeg * Math.cos(rad) * (x === 0 ? 0.3 + Math.random() * 0.5 : 1 + Math.random() * 0.4);
		if (dx >= run - x) dx = run - x;
		let dy = dx * Math.tan(rad) * (up ? -1 : 1);
		if (Math.abs(y + dy) > drift) dy = -dy;
		dy = Math.max(-drift - y, Math.min(drift - y, dy));
		x += dx;
		y += dy;
		legs.push({ x, y, heading: (Math.atan2(dy, dx) * 180) / Math.PI, len: Math.hypot(dx, dy) });
		up = dy > 0;
	}
	return legs;
}

/** A quad crosses the phone left to right on a wild route, for no reason at all. */
export function playAtvRoam(): void {
	const host = document.querySelector(".mobile-shell") ?? document.documentElement;
	const { point, origin } = localFrom(host);
	const r = host.getBoundingClientRect();
	// Only the band on screen: the inbox scrolls the window, so the shell can run far below it.
	const a = point(r.left, Math.max(r.top, 0));
	const b = point(r.right, Math.min(r.bottom, window.innerHeight));
	const left = Math.min(a.x, b.x);
	const top = Math.min(a.y, b.y);
	const width = Math.abs(b.x - a.x);
	const height = Math.abs(b.y - a.y);
	if (!width || !height) return;
	const scale = ROAM_H / SPRITE_H;
	const spriteW = SPRITE_W * scale;

	const layer = document.createElement("div");
	layer.setAttribute("aria-hidden", "true");
	layer.style.cssText = `position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:${Z_HANDS}`;
	const img = new Image();
	img.alt = "";
	img.src = "/mobileAssets/share_atv_tread_right.webp";
	const st = img.style;
	st.position = "absolute";
	st.height = `${ROAM_H}px`;
	st.width = `${spriteW}px`;
	st.maxWidth = "none";
	st.left = `${left - spriteW}px`;
	st.top = `${top + height / 2 - ROAM_H / 2}px`;
	st.transformOrigin = `${PIVOT_X * scale}px ${PIVOT_Y * scale}px`;
	layer.appendChild(img);
	(origin ?? frameFor(host) ?? document.body).appendChild(layer);

	const legs = roamRoute(
		width + 2 * spriteW,
		Math.max(0, height / 2 - ROAM_H),
		ROAM_TURN_GAP_S * SPEED_SPRITE_PX_PER_S * scale,
	);
	drive(img, legs, scale, 1, () => layer.remove());
}

/** Starts the random crossings; returns the stop. A hidden tab skips its turn. */
export function startAtvRoam(): () => void {
	let timer: ReturnType<typeof setTimeout>;
	const next = () => {
		timer = setTimeout(() => {
			if (!document.hidden) playAtvRoam();
			next();
		}, ROAM_FLOOR_MS - Math.log(1 - Math.random()) * ROAM_MEAN_EXTRA_MS);
	};
	next();
	return () => clearTimeout(timer);
}

/** Svelte action: arms the quad on tap; `{ exit }` overrides auto. */
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
