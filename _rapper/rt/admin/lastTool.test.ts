import { beforeEach, describe, expect, it } from "vitest";
import { lastTool, rememberTool } from "./lastTool";

describe("parent pills remember the last tool", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => void store.set(k, v),
			},
		});
	});

	it("is empty until a tool has been visited", () => {
		expect(lastTool("retreever")).toBeNull();
	});

	it("keeps path AND query, per parent", () => {
		rememberTool("retreever", "/retreever_dash/tool/orgs?type=parent");
		rememberTool("foundr", "/foundr_dash/tool/missmap?site=restor");
		expect(lastTool("retreever")).toBe("/retreever_dash/tool/orgs?type=parent");
		expect(lastTool("foundr")).toBe("/foundr_dash/tool/missmap?site=restor");
	});
});
