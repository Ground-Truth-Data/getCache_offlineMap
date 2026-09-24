import { describe, expect, it } from "vitest";
import { boxOfTileKey, metresBetween } from "./packDownload";

describe("blob geometry readings", () => {
	it("metresBetween matches a known distance", () => {
		const m = metresBetween(0, 0, 0, 1);
		expect(m).toBeGreaterThan(110_000);
		expect(m).toBeLessThan(112_000);
	});

	it("a tile key's box CONTAINS the pin that generated it", () => {
		const lng = -121.5722;
		const lat = 48.2164;
		const n = 2 ** 8;
		const x = Math.floor(((lng + 180) / 360) * n);
		const r = (lat * Math.PI) / 180;
		const y = Math.floor(
			((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
		);
		const box = boxOfTileKey(`8/${x}/${y}`);
		expect(box).not.toBeNull();
		if (!box) return;
		expect(lng).toBeGreaterThanOrEqual(box.w);
		expect(lng).toBeLessThanOrEqual(box.e);
		expect(lat).toBeGreaterThanOrEqual(box.s);
		expect(lat).toBeLessThanOrEqual(box.n);
	});

	it("⛔ CORNERS CATCH A STRETCH THAT A CENTRE MISSES", () => {
		// A box stretched 1.86× anchored top-left barely moves its centre; the SE corner moves far.
		const pinLng = -121.5722;
		const pinLat = 48.2164;
		const good = { w: -121.6, s: 48.15, e: -121.5, n: 48.25 };
		const f = 1.86;
		const bad = {
			w: good.w,
			n: good.n,
			e: good.w + (good.e - good.w) * f,
			s: good.n - (good.n - good.s) * f,
		};

		const centreOff = (b: typeof good): number =>
			metresBetween(pinLng, pinLat, (b.w + b.e) / 2, (b.s + b.n) / 2);
		const seCorner = (b: typeof good): number =>
			metresBetween(pinLng, pinLat, b.e, b.s);

		const centreDrift = Math.abs(centreOff(bad) - centreOff(good));
		const cornerDrift = Math.abs(seCorner(bad) - seCorner(good));

		expect(cornerDrift).toBeGreaterThan(centreDrift * 2);
		expect(cornerDrift).toBeGreaterThan(4_000);
	});

	it("a malformed key yields no box rather than NaN coordinates", () => {
		expect(boxOfTileKey("not/a/key")).toBeNull();
		expect(boxOfTileKey("")).toBeNull();
	});
});
