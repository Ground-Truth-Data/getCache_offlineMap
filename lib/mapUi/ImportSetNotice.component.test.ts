// @vitest-environment happy-dom
import { render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ blob: null as null | ((e: unknown) => void), estimate: vi.fn(async () => 1048576) }));
vi.mock("../../routes/offlinev10/blobService", () => ({
	onBlob: (fn: (e: unknown) => void) => ((h.blob = fn), () => void (h.blob = null)),
	saveSpots: () => {},
}));
vi.mock("../../routes/offlinev10/download", () => ({ estimateBytes: h.estimate }));

import ImportSetNotice from "./ImportSetNotice.svelte";

const set = (n: number) => {
	const all = Array.from({ length: n }, (_, i) => ({ at: [i, 0] as [number, number], photo: true }));
	return { key: `k${n}`, name: "Block", here: all, all };
};

describe("ImportSetNotice — Bulk Download stops at 50 pins", () => {
	it("offers Download for 50", () => {
		const { container } = render(ImportSetNotice);
		h.blob!({ kind: "waiting", sets: [set(50)] });
		flushSync();
		expect(container.querySelector("button")).not.toBeNull();
	});

	it("says open them one at a time for 51, and never sizes them", () => {
		h.estimate.mockClear();
		const { container } = render(ImportSetNotice);
		h.blob!({ kind: "waiting", sets: [set(51)] });
		flushSync();
		expect(container.querySelector("button")).toBeNull();
		expect(container.textContent).toContain("Too many to download at once — open pins one at a time");
		expect(h.estimate).not.toHaveBeenCalled();
	});
});
