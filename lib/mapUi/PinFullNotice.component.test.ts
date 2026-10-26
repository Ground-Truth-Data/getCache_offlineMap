// @vitest-environment happy-dom
// E, on screen: a pin refused for room shows the refusal on the map, and the next blob to land clears it.
import { render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ blob: null as null | ((e: unknown) => void) }));
vi.mock("../../routes/offlinev10/blobService", () => ({ onBlob: (fn: (e: unknown) => void) => ((h.blob = fn), () => void (h.blob = null)) }));

import { BudgetError } from "../../routes/offlinev10/budget";
import PinFullNotice from "./PinFullNotice.svelte";

describe("PinFullNotice", () => {
	it("shows a refused pin's words until a blob lands", () => {
		const { container } = render(PinFullNotice);
		expect(container.querySelector("[role=alert]")).toBeNull();
		const error = new BudgetError(0, 0, 0);
		h.blob!({ kind: "failed", at: [0, 0], error });
		flushSync();
		expect(container.querySelector("[role=alert]")!.textContent).toBe(error.message);
		h.blob!({ kind: "failed", at: [0, 0], error: new Error("HTTP 500") });
		flushSync();
		expect(container.querySelector("[role=alert]")!.textContent).toBe(error.message);
		h.blob!({ kind: "landed", region: {} });
		flushSync();
		expect(container.querySelector("[role=alert]")).toBeNull();
	});
});
