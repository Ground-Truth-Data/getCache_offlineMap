// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(built: boolean, query: string) {
	vi.resetModules();
	document.body.innerHTML = "";
	history.replaceState(null, "", `/app/map${query}`);
	if (built) vi.stubGlobal("__TOUCH_DEBUG__", true);
	return (await import("./touchDebug")).touchLog;
}

function press(type: string, on: Element, fields: Record<string, unknown>) {
	const e = new Event(type, { bubbles: true });
	Object.assign(e, fields);
	on.dispatchEvent(e);
}

const log = () => document.querySelector("pre")?.textContent ?? "";

afterEach(() => vi.unstubAllGlobals());

describe("the on-phone touch log", () => {
	it("is absent from a normal build, and from a debug build opened without ?touchdebug", async () => {
		expect(await load(false, "?touchdebug")).toBeUndefined();
		expect(await load(true, "")).toBeUndefined();
	});

	it("names each press, newest first: the ruler's hand, the map, anything else by its tag", async () => {
		const touchLog = await load(true, "?touchdebug");
		const grab = document.createElement("div");
		grab.className = "rt-measure-grab";
		const canvas = document.createElement("div");
		canvas.className = "maplibregl-canvas-container";
		const button = document.createElement("button");
		document.body.append(grab, canvas, button);

		press("pointerdown", grab, { pointerType: "touch", pointerId: 1, clientX: 10.4, clientY: 20.6 });
		press("touchstart", canvas, { touches: [{}, {}], changedTouches: [{ identifier: 3, clientX: 5, clientY: 6 }] });
		press("mousedown", button, { clientX: 1, clientY: 2 });
		touchLog!("MAP HELD");

		const lines = log().split("\n").slice(1).map((l) => l.replace(/^\S+ /, ""));
		expect(lines).toEqual(["MAP HELD", "mousedown 1,2 button", "touchstart n=2 #3@5,6 map", "pointerdown touch#1 10,21 HAND"]);
	});

	it("keeps the newest 22 lines", async () => {
		const touchLog = (await load(true, "?touchdebug"))!;
		for (let i = 0; i < 30; i++) touchLog(`line ${i}`);
		const lines = log().split("\n").slice(1);
		expect(lines).toHaveLength(22);
		expect(lines[0]).toMatch(/line 29$/);
	});
});
