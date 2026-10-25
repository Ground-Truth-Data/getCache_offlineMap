/// <reference lib="webworker" />
// The router off the UI thread: a city graph is a second of solid compute, and the map must keep panning through it.

import type { LngLat } from "../shared/kmGeo";
import { decodeRoads, findRoute, type RoadLine, type TileId } from "./roadGraph";

export type ToWorker = { kind: "route"; job: number; stops: LngLat[] } | { kind: "tile"; ask: number; bytes: ArrayBuffer | undefined };
export type FromWorker =
	| { kind: "done"; job: number; result: Awaited<ReturnType<typeof findRoute>> }
	| { kind: "tile"; ask: number; key: string };

const DECODED_CAP = 3000;
const decoded = new Map<string, RoadLine[]>();
const asked = new Map<number, (bytes: ArrayBuffer | undefined) => void>();
let asks = 0;
const post = (m: FromWorker): void => (self as unknown as Worker).postMessage(m);

const read = async (t: TileId): Promise<RoadLine[] | null> => {
	const key = `${t.z}/${t.x}/${t.y}`;
	const hit = decoded.get(key);
	if (hit) return hit;
	const ask = ++asks;
	const bytes = await new Promise<ArrayBuffer | undefined>((res) => {
		asked.set(ask, res);
		post({ kind: "tile", ask, key });
	});
	if (bytes === undefined) return null;
	const lines = decodeRoads(t, bytes);
	if (decoded.size >= DECODED_CAP) decoded.delete(decoded.keys().next().value as string);
	decoded.set(key, lines);
	return lines;
};

self.onmessage = async (e: MessageEvent<ToWorker>): Promise<void> => {
	const m = e.data;
	if (m.kind === "tile") {
		asked.get(m.ask)?.(m.bytes);
		asked.delete(m.ask);
		return;
	}
	post({ kind: "done", job: m.job, result: await findRoute(m.stops, read) });
};
