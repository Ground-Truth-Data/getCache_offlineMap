// @vitest-environment happy-dom
// What the ruler draws is a block or a piece, never a map: Save wears the kind
// the store would give it, re-asked as the corners move. No switch overrides it.
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import type { Polygon } from "geojson";
import { createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";
import RulerSave from "./RulerSave.svelte";

type Lnglat = [number, number];
const OPEN: Lnglat[] = [[0.03, 0], [0.04, 0], [0.04, 0.01]];
const ON_BLOCK: Lnglat[] = [[0.005, 0.005], [0.015, 0.005], [0.015, 0.015]];

// West block: 0..0.01 square.
const bornAs = vi.fn(async (where: Polygon) => {
	const xs = where.coordinates[0].map((p) => p[0]);
	return { block: Math.min(...xs) >= 0.03 };
});

const glyph = (c: HTMLElement) => c.querySelector<HTMLImageElement>(".measure-save img")!.getAttribute("src")!;
const save = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".measure-save")!;

describe("the ruler's Save shows block or piece", () => {
	it("off a block it saves a block, on a block a piece, and offers no switch", async () => {
		const onSave = vi.fn();
		const { container, rerender } = render(RulerSave, { ring: OPEN, bornAs, onSave });
		await waitFor(() => expect(glyph(container)).toMatch(/block_icon/));
		await fireEvent.click(save(container));
		expect(onSave).toHaveBeenLastCalledWith(true);
		await rerender({ ring: ON_BLOCK });
		await waitFor(() => expect(glyph(container)).toMatch(/polyHeart/));
		await fireEvent.click(save(container));
		expect(onSave).toHaveBeenLastCalledWith(false);
		expect(container.querySelectorAll("button")).toHaveLength(1);
	});

	it("Share is handed the same kind", async () => {
		const onShare = vi.fn();
		const share = createRawSnippet((asBlock: () => boolean | undefined) => ({
			render: () => `<button class="sharer">Share</button>`,
			setup: (node) => {
				node.addEventListener("click", () => onShare(asBlock()));
			},
		}));
		const { container } = render(RulerSave, { ring: ON_BLOCK, bornAs, onSave: vi.fn(), share });
		await waitFor(() => expect(glyph(container)).toMatch(/polyHeart/));
		await fireEvent.click(container.querySelector(".sharer")!);
		expect(onShare).toHaveBeenLastCalledWith(false);
	});
});
