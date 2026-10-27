import { openSync, readSync } from "node:fs";
import { PMTiles } from "pmtiles";
import { expect, it } from "vitest";
import { decodeRoads, RoadGraph, type TileId } from "./roadGraph";
it("p", async () => {
	const fd = openSync(new URL("../../../getCache/scripts/.cache/highways.pmtiles", import.meta.url), "r");
	const a = new PMTiles({ getKey: () => "h", getBytes: async (o: number, l: number) => { const d = new Uint8Array(l); readSync(fd, d, 0, l, o); return { data: d.buffer }; } });
	const tiles: TileId[] = [];
	for (let x = 41; x <= 43; x++) for (let y = 85; y <= 87; y++) tiles.push({ z: 8, x, y });
	const lines = (await Promise.all(tiles.map(async (t) => { const g = await a.getZxy(t.z, t.x, t.y); return g ? decodeRoads(t, g.data) : []; }))).flat();
	const g = new RoadGraph(lines, 50.6);
	const K = g.attach([-120.33, 50.675])!;
	const out: string[] = [];
	for (const c of [[-120.0, 50.65], [-119.97, 50.65], [-119.949, 50.643], [-119.947, 50.636], [-119.944, 50.635], [-119.862, 50.548], [-119.545, 50.498], [-119.27, 50.27]] as [number, number][]) {
		const B = g.attach(c); const p = B && g.path(K.node, B.node);
		out.push(`${c} off ${B?.offM.toFixed(0)} → ${p ? (g.metres(p) / 1000).toFixed(1) : "none"}`);
	}
	expect(out).toEqual([]);
});
