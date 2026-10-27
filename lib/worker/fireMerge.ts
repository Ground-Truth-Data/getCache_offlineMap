/** The Worker's half of the fire rule: hotspots within FIRE_JOIN_KM are one fire, and a disc carries the nearest
 * FIRE_MAX_COUNT fires with lines around their real hotspots, plus every hotspot near its centre. */

import { CELL_DEG, fireOutlines } from "../../routes/fires/fireOutline";
import {
	FIRE_JOIN_KM,
	FIRE_MAX_COUNT,
	FIRE_NEAR_SEND_KM,
	PASS_BUCKET_MS,
	type FireConfidence,
} from "../shared/fireContract";
import { distanceKm, type FireCollection } from "./firesWorker";

type Spot = FireCollection["features"][number];
type Props = Record<string, unknown>;
export interface MergedFireCollection {
	readonly type: "FeatureCollection";
	readonly features: Array<
		| { type: "Feature"; geometry: { type: "Point"; coordinates: readonly [number, number] }; properties: Props }
		| { type: "Feature"; geometry: { type: "Polygon"; coordinates: number[][][] }; properties: Props }
	>;
}

const RANK: Record<FireConfidence, number> = { low: 0, nominal: 1, high: 2 };
const KM_PER_DEG = 111.19;

export function mergeFires(
	input: FireCollection,
	lng: number,
	lat: number,
	km: number,
): { collection: MergedFireCollection; radiusKm: number } {
	const spots = input.features;
	const at = (s: Spot) => s.geometry.coordinates;
	const d = spots.map((s) => distanceKm(lng, lat, at(s)[0], at(s)[1]));

	// Single linkage over a JOIN-sized grid; the grid's longitude step is sized at the disc's highest latitude.
	const parent = spots.map((_, i) => i);
	const root = (i: number): number => {
		while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
		return i;
	};
	const stepLat = FIRE_JOIN_KM / KM_PER_DEG;
	const stepLng = stepLat / Math.max(0.01, Math.cos((Math.min(89, Math.abs(lat) + km / KM_PER_DEG) * Math.PI) / 180));
	const grid = new Map<string, number[]>();
	spots.forEach((s, i) => {
		const gx = Math.floor(at(s)[0] / stepLng);
		const gy = Math.floor(at(s)[1] / stepLat);
		for (let x = gx - 1; x <= gx + 1; x++)
			for (let y = gy - 1; y <= gy + 1; y++)
				for (const j of grid.get(`${x},${y}`) ?? [])
					if (distanceKm(at(s)[0], at(s)[1], at(spots[j]!)[0], at(spots[j]!)[1]) <= FIRE_JOIN_KM) parent[root(i)] = root(j);
		const key = `${gx},${gy}`;
		const cell = grid.get(key);
		if (cell) cell.push(i);
		else grid.set(key, [i]);
	});

	const groups = new Map<number, number[]>();
	spots.forEach((_, i) => {
		const g = groups.get(root(i));
		if (g) g.push(i);
		else groups.set(root(i), [i]);
	});
	const fires = [...groups.values()]
		.map((members) => ({ members, nearKm: Math.min(...members.map((i) => d[i]!)) }))
		.sort((a, b) => a.nearKm - b.nearKm);
	const kept = fires.slice(0, FIRE_MAX_COUNT);
	const radiusKm = fires.length > FIRE_MAX_COUNT ? Math.min(km, Math.floor(fires[FIRE_MAX_COUNT]!.nearKm * 10) / 10) : km;

	const out: MergedFireCollection["features"] = [];
	const near: { i: number; f: string }[] = [];
	for (const { members } of kept) {
		const hottest = members.reduce((h, i) => (spots[i]!.properties.frp > spots[h]!.properties.frp ? i : h));
		const [hx, hy] = at(spots[hottest]!);
		const f = `${hx.toFixed(5)},${hy.toFixed(5)}`;
		const cells = new Set(members.map((i) => `${Math.round(at(spots[i]!)[0] / CELL_DEG)},${Math.round(at(spots[i]!)[1] / CELL_DEG)}`));
		const passes = new Map<number, number>();
		for (const i of members) {
			const { t, frp } = spots[i]!.properties;
			const pass = Math.floor(t / PASS_BUCKET_MS) * PASS_BUCKET_MS;
			passes.set(pass, Math.max(passes.get(pass) ?? 0, frp));
		}
		const ts = members.map((i) => spots[i]!.properties.t);
		out.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: [hx, hy] },
			properties: {
				f,
				n: members.length,
				a: cells.size,
				t: Math.max(...ts),
				t0: Math.min(...ts),
				frp: spots[hottest]!.properties.frp,
				c: members.map((i) => spots[i]!.properties.c).reduce((b, c) => (RANK[c] > RANK[b] ? c : b)),
				p: [...passes].sort((a, b) => a[0] - b[0]),
			},
		});
		for (const g of fireOutlines(members.map((i) => ({ coordinates: at(spots[i]!) })), { f }).features)
			out.push(g as MergedFireCollection["features"][number]);
		for (const i of members) if (d[i]! <= FIRE_NEAR_SEND_KM) near.push({ i, f });
	}
	for (const { i, f } of near.sort((a, b) => d[a.i]! - d[b.i]!).slice(0, FIRE_MAX_COUNT))
		out.push({ ...spots[i]!, properties: { ...spots[i]!.properties, f } });

	return { collection: { type: "FeatureCollection", features: out }, radiusKm };
}
