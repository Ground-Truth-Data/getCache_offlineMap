// @vitest-environment happy-dom
// Legend toggles persist; fires and hospitals hidden for twelve hours show
// themselves again, and any unreadable storage fails open (shown).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const load = async () => {
	vi.resetModules();
	return (await import("./overlayVisibility.svelte")).overlayVisibility;
};
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("overlayVisibility", () => {
	it("starts with everything shown and remembers a toggle across a reload", async () => {
		const v = await load();
		expect([v.pins, v.plots, v.shapes, v.pdf, v.fires, v.hospitals, v.isVisible("labels")]).toEqual([true, true, true, true, true, true, true]);
		v.toggle("plots");
		v.set("labels", false);
		const again = await load();
		expect(again.plots).toBe(false);
		expect(again.isVisible("labels")).toBe(false);
		expect(again.pins).toBe(true);
	});

	it("re-arms a hidden safety layer after twelve hours, and not before", async () => {
		vi.useFakeTimers({ now: 1_000_000_000_000 });
		const v = await load();
		v.set("fires", false);
		v.set("hospitals", false);
		expect(localStorage.getItem("retreever-fires-hidden-at")).toBe("1000000000000");
		vi.setSystemTime(1_000_000_000_000 + 11 * 3_600_000);
		expect((await load()).fires).toBe(false);
		vi.setSystemTime(1_000_000_000_000 + 12 * 3_600_000);
		const later = await load();
		expect([later.fires, later.hospitals]).toEqual([true, true]);
		later.set("fires", true);
		expect(localStorage.getItem("retreever-fires-hidden-at")).toBeNull();
	});

	it("shows a safety layer whose hide time is missing, and everything when the store is corrupt", async () => {
		localStorage.setItem("retreever-overlay-visibility", JSON.stringify({ fires: false, pins: false }));
		const v = await load();
		expect([v.fires, v.pins]).toEqual([true, false]);
		localStorage.setItem("retreever-overlay-visibility", "{nope");
		expect((await load()).pins).toBe(true);
	});

	it("keeps working when storage throws", async () => {
		const v = await load();
		vi.stubGlobal("localStorage", { setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("quota"); } });
		v.set("hospitals", false);
		v.set("hospitals", true);
		expect(v.hospitals).toBe(true);
		vi.unstubAllGlobals();
	});
});
