// @vitest-environment happy-dom
// The popover sits where the geometry places it above the map's floor, a pin
// gets a dotted leader, and a gesture that starts outside the card passes
// through to the map until every finger lifts.
import { render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MapPopoverShell from "./MapPopoverShell.svelte";
import { placePopover } from "./mapPopoverGeom";

const W = 400;
const H = 800;
const bbox = { minX: 190, minY: 390, maxX: 210, maxY: 410 };
const children = createRawSnippet(() => ({ render: () => `<p class="body">Block 7</p>` }));

beforeEach(() => {
	const canvas = Object.defineProperties(document.createElement("canvas"), { offsetHeight: { value: H }, offsetWidth: { value: W } });
	canvas.className = "maplibregl-canvas";
	canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
	document.body.appendChild(canvas);
});
afterEach(() => {
	document.body.innerHTML = "";
});

const ptr = (type: string, target: EventTarget, pointerId: number) => {
	const e = new Event(type, { bubbles: true });
	Object.defineProperty(e, "pointerId", { value: pointerId });
	target.dispatchEvent(e);
};

describe("MapPopoverShell", () => {
	it("places the card from the geometry, above the floor, with a leader to a pin", () => {
		const { container } = render(MapPopoverShell, { bbox, containerWidth: W, containerHeight: H, isPoint: true, children });
		const card = container.querySelector<HTMLDivElement>(".rt-fmp")!;
		expect(card.querySelector(".body")!.textContent).toBe("Block 7");
		const g = placePopover({ bbox, containerWidth: W, containerHeight: H, isPoint: true, wide: false, topReserve: 150, bottomReserve: 8, crow: null });
		expect(card.style.left).toBe(`${g.left}px`);
		expect(card.style.top).toBe(`${g.top}px`);
		expect(card.style.width).toBe(`${g.width}px`);
		const svg = container.querySelector("svg.rt-fmp-leader")!;
		expect(svg.getAttribute("viewBox")).toBe(`0 0 ${W} ${H}`);
		expect(svg.querySelector("line")).not.toBeNull();
		expect(card.classList.contains("rt-fmp--locked")).toBe(false);
	});

	it("a shape gets no leader, and a locked card says so", () => {
		const { container } = render(MapPopoverShell, { bbox, containerWidth: W, containerHeight: H, wide: true, scrollLocked: true, children });
		expect(container.querySelector("svg.rt-fmp-leader")).toBeNull();
		expect(container.querySelector(".rt-fmp")!.classList.contains("rt-fmp--locked")).toBe(true);
	});

	it("a gesture begun on the map passes through the card; one begun on the card does not", () => {
		const { container, unmount } = render(MapPopoverShell, { bbox, containerWidth: W, containerHeight: H, children });
		const card = container.querySelector<HTMLDivElement>(".rt-fmp")!;
		ptr("pointerdown", document.body, 1);
		expect(card.style.pointerEvents).toBe("none");
		ptr("pointerdown", card, 2);
		expect(card.style.pointerEvents).toBe("none");
		ptr("pointerup", document.body, 1);
		expect(card.style.pointerEvents).toBe("none");
		ptr("pointercancel", document.body, 2);
		expect(card.style.pointerEvents).toBe("");
		ptr("pointerdown", card, 3);
		expect(card.style.pointerEvents).toBe("");
		ptr("pointerdown", document.body, 4);
		expect(card.style.pointerEvents).toBe("none");
		unmount();
	});
});
