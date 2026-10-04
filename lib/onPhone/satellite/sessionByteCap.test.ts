/** Once the session byte cap trips, a photo bake asks for no tiles at all — disk or network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/keyedIdbStore", () => ({
	makeKeyedIdbStore: () => ({
		get: async () => undefined,
		keys: async () => [],
		put: async () => undefined,
		delete: async () => undefined,
		getAll: async () => [],
		getAllProjected: async () => [],
	}),
}));

const PIN: [number, number] = [7.2, 43.68];

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the session byte cap", () => {
	it("stops a bake before it asks for a single tile", async () => {
		const { sessionCap, spendBytes, SESSION_BYTE_CAP } = await import("../../shared/sessionByteCap.svelte");
		const { bakeSatelliteImage } = await import("./satelliteImage");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		spendBytes(SESSION_BYTE_CAP + 1);
		expect(sessionCap.tripped).toBe(true);

		const source = vi.fn(async () => new Map<string, ArrayBuffer>());
		expect(await bakeSatelliteImage("7.2000,43.6800", PIN, source)).toBeNull();
		expect(source).not.toHaveBeenCalled();
	});
});
