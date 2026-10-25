import { describe, expect, it } from "vitest";
import type { LngLat } from "../shared/kmGeo";
import { findRoute, type RoadLine, ROUTE_Z, type TileId, toLngLat, toWorld } from "./roadGraph";

const ORIGIN: LngLat = [136.8, -13.8];
const [OX, OY] = toWorld(ORIGIN);
// ~1.17 m per world unit at this latitude; offsets below are in metres.
const M = 1 / 1.165;
const pt = (east: number, south: number): [number, number] => [OX + east * M, OY + south * M];
const at = (east: number, south: number): LngLat => toLngLat(...pt(east, south));
const road = (cost: number, ...pts: Array<[number, number]>): RoadLine => ({ pts: pts.map(([e, s]) => pt(e, s)), cost });

/** Each line lives in the tile of its first point; `missing` = every other tile is absent from the pack. */
function reader(lines: RoadLine[], missing = false) {
	const home = (l: RoadLine) => `${Math.floor(l.pts[0][0] / 4096)}/${Math.floor(l.pts[0][1] / 4096)}`;
	return async (t: TileId): Promise<RoadLine[] | null> => {
		const mine = lines.filter((l) => home(l) === `${t.x}/${t.y}`);
		return mine.length || !missing ? mine : null;
	};
}

describe("findRoute", () => {
	const main = road(1, [0, 0], [2000, 0]);

	it("joins a side road whose junction vertex Protomaps dropped", async () => {
		// The side road stops 1 m short of the main road's mid-segment — no shared vertex.
		const side = road(1.3, [1000, 1], [1000, 800]);
		const r = await findRoute([at(1000, 800), at(2000, 0)], reader([main, side]));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.km).toBeCloseTo(1.8, 1);
	});

	it("answers no road when the two ends are on separate networks", async () => {
		const island = road(1, [0, 5000], [2000, 5000]);
		const r = await findRoute([at(0, 0), at(0, 5000)], reader([main, island]));
		expect(r).toMatchObject({ ok: false, reason: "no-road" });
	});

	it("says which tiles were missing when it cannot route", async () => {
		const r = await findRoute([at(0, 0), at(0, 5000)], reader([main], true));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.missing).toBeGreaterThan(0);
	});

	it("answers no road for a stop kilometres from any road", async () => {
		const r = await findRoute([at(0, 0), at(1000, 9000)], reader([main]));
		expect(r).toMatchObject({ ok: false, reason: "no-road" });
	});

	it("takes the track over a footpath of the same length", async () => {
		const track = road(1.6, [0, 0], [1000, 600], [2000, 0]);
		const foot = road(5, [0, 0], [1000, -600], [2000, 0]);
		const r = await findRoute([at(0, 0), at(2000, 0)], reader([track, foot]));
		expect(r.ok && r.line.some(([, lat]) => lat < ORIGIN[1] - 0.004)).toBe(true);
	});

	it("routes through a waypoint and ends each leg on its stop", async () => {
		const loop = [main, road(1, [2000, 0], [2000, 1000], [0, 1000], [0, 0])];
		const r = await findRoute([at(0, 0), at(1000, 1000), at(2000, 0)], reader(loop));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.legEnds).toHaveLength(2);
		expect(r.km).toBeCloseTo(4, 1);
	});

	it("widens the search when the only road swings far outside the straight line", async () => {
		// Two spurs joined only 6 km south — past the first box's 3 km pad, inside the widened 7.5 km one.
		const lines = [road(1, [0, 0], [0, 6000]), road(1, [10000, 0], [10000, 6000]), road(1, [500, 6000], [0, 6000], [10000, 6000])];
		const r = await findRoute([at(0, 0), at(10000, 0)], reader(lines));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.km).toBeCloseTo(22, 0);
	});

	it("draws a dashed walk from a stop that sits off the road", async () => {
		const r = await findRoute([at(500, 200), at(2000, 0)], reader([main]));
		expect(r.ok && r.offRoad.length).toBe(1);
	});

	it("refuses a request too big to be a drive", async () => {
		const far: LngLat = [ORIGIN[0] + 10, ORIGIN[1]];
		const r = await findRoute([ORIGIN, far], reader([]));
		expect(r).toMatchObject({ ok: false, reason: "too-far" });
		expect(ROUTE_Z).toBe(13);
	});
});
