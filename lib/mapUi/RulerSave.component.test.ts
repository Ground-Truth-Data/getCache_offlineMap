// @vitest-environment happy-dom
// What the ruler draws is a block or a piece, never a map: Save wears the kind
// the store would give it, re-asked as the corners move, and the drawer's own
// switch flips it before the save.
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import type { Polygon } from "geojson";
import { describe, expect, it, vi } from "vitest";
import RulerSave from "./RulerSave.svelte";

type Lnglat = [number, number];
const OPEN: Lnglat[] = [[0.03, 0], [0.04, 0], [0.04, 0.01]];
const ON_BLOCK: Lnglat[] = [[0.005, 0.005], [0.015, 0.005], [0.015, 0.015]];
const TOUCHING: Lnglat[] = [[0.01, 0], [0.02, 0], [0.02, 0.01]];

// West block: 0..0.01 square. Overlap names it; a shared edge only touches.
const bornAs = vi.fn(async (where: Polygon) => {
	const xs = where.coordinates[0].map((p) => p[0]);
	if (Math.min(...xs) >= 0.03) return { block: true, overlaps: null };
	if (Math.min(...xs) >= 0.01) return { block: false, overlaps: null };
	return { block: false, overlaps: "West" };
});

const glyph = (c: HTMLElement) => c.querySelector<HTMLImageElement>(".measure-save img")!.getAttribute("src")!;
const save = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".measure-save")!;
const swap = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".cl-switch")!;

describe("the ruler's Save shows block or piece", () => {
	it("on open ground it defaults to a block", async () => {
		const { container } = render(RulerSave, { ring: OPEN, bornAs, onSave: vi.fn() });
		await waitFor(() => expect(glyph(container)).toMatch(/block_icon/));
		expect(swap(container).textContent).toContain("make piece");
	});

	it("over a block it defaults to a piece, and can't be made a block", async () => {
		const { container } = render(RulerSave, { ring: ON_BLOCK, bornAs, onSave: vi.fn() });
		await waitFor(() => expect(glyph(container)).toMatch(/polyHeart/));
		expect(swap(container).textContent).toContain("make block");
		expect(swap(container).disabled).toBe(true);
	});

	it("switches live as a corner is dragged onto and off a block", async () => {
		const { container, rerender } = render(RulerSave, { ring: OPEN, bornAs, onSave: vi.fn() });
		await waitFor(() => expect(glyph(container)).toMatch(/block_icon/));
		await rerender({ ring: ON_BLOCK });
		await waitFor(() => expect(glyph(container)).toMatch(/polyHeart/));
		await rerender({ ring: OPEN });
		await waitFor(() => expect(glyph(container)).toMatch(/block_icon/));
	});

	it("Save saves the kind showing after a manual switch", async () => {
		const onSave = vi.fn();
		const { container } = render(RulerSave, { ring: OPEN, bornAs, onSave });
		await waitFor(() => expect(glyph(container)).toMatch(/block_icon/));
		await fireEvent.click(swap(container));
		expect(glyph(container)).toMatch(/polyHeart/);
		await fireEvent.click(save(container));
		expect(onSave).toHaveBeenLastCalledWith(false);
	});

	it("a piece touching a block can be made a block", async () => {
		const onSave = vi.fn();
		const { container } = render(RulerSave, { ring: TOUCHING, bornAs, onSave });
		await waitFor(() => expect(glyph(container)).toMatch(/polyHeart/));
		await fireEvent.click(swap(container));
		await fireEvent.click(save(container));
		expect(onSave).toHaveBeenLastCalledWith(true);
	});
});
