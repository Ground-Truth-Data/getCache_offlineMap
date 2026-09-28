// `null` = no frame on this page; `undefined` = not looked yet. Those were once the same
// value inside the watcher, so a frameless page's first look was mistaken for "nothing
// changed" and never reported — SideCard stuck `--unplaced` (visibility: hidden) everywhere.
import { afterEach, describe, expect, it, vi } from "vitest";

const stubDom = (frame: unknown) => {
	const prev = globalThis.document;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { querySelector: () => frame, body: {} },
	});
	Object.defineProperty(globalThis, "MutationObserver", {
		configurable: true,
		value: class {
			observe() {}
			disconnect() {}
		},
	});
	return () => Object.defineProperty(globalThis, "document", { configurable: true, value: prev });
};

afterEach(() => vi.resetModules());

describe("watchPhoneFrame", () => {
	it("reports null on a page that never had a frame", async () => {
		const restore = stubDom(null);
		const { watchPhoneFrame } = await import("./phoneFrame.svelte");
		const onChange = vi.fn();
		const stop = watchPhoneFrame(onChange);
		expect(onChange).toHaveBeenCalledWith(null);
		stop();
		restore();
	});
});
