/**
 * Real worker bytes through real storage, decoded by the parser MapLibre uses:
 * buildBlobTile → idb store under pinTileKey → idbGetTileForAddress → vector-tile + pbf.
 */
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/sveltekit", () => ({ captureMessage: vi.fn() }));

import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import {
	boxFrame,
	buildBlobTile,
	type SourceTile,
} from "../../../workers/worker-local-dev/src/oneBlob";
import {
	cellBox,
	cellKey,
	cellsFor,
	pinTileKey,
	type Cell,
} from "../../contract/grid";
import {
	DB_NAME,
	DB_VERSION,
	idbGetTile,
	idbGetTileForAddress,
} from "../../worker/worker-local-dev/roads/packDownload";

function writeVarint(out: number[], value: number): void {
	let v = value;
	while (v > 0x7f) {
		out.push((v & 0x7f) | 0x80);
		v = Math.floor(v / 128);
	}
	out.push(v);
}

function bytesField(field: number, payload: Uint8Array): number[] {
	const out: number[] = [];
	writeVarint(out, (field << 3) | 2);
	writeVarint(out, payload.length);
	for (const b of payload) out.push(b);
	return out;
}

function strValue(s: string): Uint8Array {
	return new Uint8Array(bytesField(1, new TextEncoder().encode(s)));
}

function zz(v: number): number {
	return v >= 0 ? v * 2 : -v * 2 - 1;
}

/** MoveTo(1) + LineTo(2): a 3-vertex linestring from (x0,y0). */
function lineGeom(x0: number, y0: number): number[] {
	return [9, zz(x0), zz(y0), 18, zz(60), zz(10), zz(-20), zz(40)];
}

function feature(tags: number[], geom: number[]): Uint8Array {
	const packed: number[] = [];
	for (const n of tags) writeVarint(packed, n);
	const out: number[] = [];
	for (const b of bytesField(2, new Uint8Array(packed))) out.push(b);
	out.push((3 << 3) | 0, 2); // type = LINESTRING
	for (const b of bytesField(4, new Uint8Array(geom))) out.push(b);
	return new Uint8Array(out);
}

function layer(
	name: string,
	keys: string[],
	values: Uint8Array[],
	features: Uint8Array[],
	extent: number,
): Uint8Array {
	const body: number[] = [];
	for (const b of bytesField(1, new TextEncoder().encode(name))) body.push(b);
	for (const k of keys)
		for (const b of bytesField(3, new TextEncoder().encode(k))) body.push(b);
	for (const v of values) for (const b of bytesField(4, v)) body.push(b);
	writeVarint(body, (5 << 3) | 0);
	writeVarint(body, extent);
	for (const f of features) for (const b of bytesField(2, f)) body.push(b);
	return new Uint8Array(body);
}

function tile(layers: Uint8Array[]): Uint8Array {
	const out: number[] = [];
	for (const l of layers) for (const b of bytesField(3, l)) out.push(b);
	return new Uint8Array(out);
}

const SRC_Z = 13;
const SRC_EXTENT = 4096;

function mercY(lat: number): number {
	const s = Math.sin((lat * Math.PI) / 180);
	return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function srcTileAt(lng: number, lat: number) {
	const n = 2 ** SRC_Z;
	return {
		z: SRC_Z,
		x: Math.floor(((lng + 180) / 360) * n),
		y: Math.floor(mercY(lat) * n),
	};
}

/** The two owners carry the same tags with tables in opposite order: the worst case for tag remapping. */
function ownerTile(owner: "A" | "B"): Uint8Array {
	const keys = owner === "A" ? ["kind", "owner"] : ["owner", "kind"];
	const vals =
		owner === "A"
			? [strValue("highway"), strValue("A")]
			: [strValue("B"), strValue("path")];
	const g = owner === "A" ? lineGeom(1950, 1950) : lineGeom(1850, 2050);
	return tile([
		layer(
			"roads",
			keys,
			vals,
			[feature([0, 0, 1, 1], g), feature([0, 0, 1, 1], g)],
			SRC_EXTENT,
		),
	]);
}

// Close enough that their boxes share z8 cells.
const PIN_A: [number, number] = [-100.5, 45.0];
const PIN_B: [number, number] = [-100.3, 45.0];

function putBlobs(items: Array<[string, ArrayBuffer]>): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains("tiles"))
				req.result.createObjectStore("tiles");
			if (!req.result.objectStoreNames.contains("shallowTiles"))
				req.result.createObjectStore("shallowTiles");
		};
		req.onsuccess = () => {
			const db = req.result;
			const tx = db.transaction("tiles", "readwrite");
			for (const [k, b] of items) tx.objectStore("tiles").put(b, k);
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				db.close();
				reject(tx.error);
			};
		};
		req.onerror = () => reject(req.error);
	});
}

async function storePinBlobs(
	pin: [number, number],
	owner: "A" | "B",
): Promise<void> {
	const items: Array<[string, ArrayBuffer]> = [];
	for (const cell of cellsFor(pin[0], pin[1])) {
		const box = cellBox(cell);
		const src: SourceTile = {
			tile: srcTileAt((box.w + box.e) / 2, (box.n + box.s) / 2),
			data: ownerTile(owner),
		};
		const { bytes, features, dropped } = buildBlobTile([src], boxFrame(box));
		if (features !== 2 || dropped !== 0)
			throw new Error(
				`fixture failed for ${owner} @ ${cellKey(cell)}: ${features} features, ${dropped} dropped`,
			);
		items.push([pinTileKey(pin[0], pin[1], cell), bytes.buffer as ArrayBuffer]);
	}
	await putBlobs(items);
}

function owns(c: Cell, cells: Cell[]): boolean {
	return cells.some((o) => cellKey(o) === cellKey(c));
}

function decode(buf: ArrayBuffer) {
	return new VectorTile(new Pbf(new Uint8Array(buf)));
}

function geomSigs(l: {
	length: number;
	feature(i: number): { loadGeometry(): Array<Array<{ x: number; y: number }>> };
}): string[] {
	return Array.from({ length: l.length }, (_, i) =>
		l
			.feature(i)
			.loadGeometry()
			.map((ring) => ring.map((p) => `${p.x},${p.y}`).join(" "))
			.join(" / "),
	);
}

describe("TWO NEARBY PINS — real worker blobs, real storage, real parser", () => {
	it("the premise holds: the pins share at least one z8 cell", () => {
		const aCells = cellsFor(PIN_A[0], PIN_A[1]);
		const bCells = cellsFor(PIN_B[0], PIN_B[1]);
		expect(aCells.filter((c) => owns(c, bCells)).length).toBeGreaterThan(0);
	});

	it("⛔ a SHARED address returns ONE tile with BOTH pins' features — no erased pin, no strips", async () => {
		await storePinBlobs(PIN_A, "A");
		await storePinBlobs(PIN_B, "B");

		const shared = cellsFor(PIN_A[0], PIN_A[1]).filter((c) =>
			owns(c, cellsFor(PIN_B[0], PIN_B[1])),
		);
		const cell = shared[0];
		const buf = await idbGetTileForAddress(cell.z, cell.ix, cell.iy);
		expect(buf).not.toBeNull();
		expect(buf!.byteLength).toBeGreaterThan(0);

		const t = decode(buf!);
		expect(Object.keys(t.layers)).toEqual(["roads"]);
		const roads = t.layers.roads;
		expect(roads.length).toBe(4); // byte-concat would show only 2

		const props = Array.from({ length: roads.length }, (_, i) =>
			roads.feature(i).properties,
		);
		expect(props.filter((p) => p.owner === "A").length).toBe(2);
		expect(props.filter((p) => p.owner === "B").length).toBe(2);
		for (const p of props) {
			if (p.owner === "A") expect(p.kind).toBe("highway");
			if (p.owner === "B") expect(p.kind).toBe("path");
		}
	});

	it("⛔ merged geometry is VERBATIM — identical to each pin decoded on its own", async () => {
		await storePinBlobs(PIN_A, "A");
		await storePinBlobs(PIN_B, "B");
		const aCells = cellsFor(PIN_A[0], PIN_A[1]);
		const bCells = cellsFor(PIN_B[0], PIN_B[1]);
		const cell = aCells.filter((c) => owns(c, bCells))[0];

		const merged = decode(
			(await idbGetTileForAddress(cell.z, cell.ix, cell.iy))!,
		).layers.roads;
		const aSolo = decode(
			(await idbGetTile(pinTileKey(PIN_A[0], PIN_A[1], cell)))!,
		).layers.roads;
		const bSolo = decode(
			(await idbGetTile(pinTileKey(PIN_B[0], PIN_B[1], cell)))!,
		).layers.roads;

		expect([...geomSigs(merged)].sort()).toEqual(
			[...geomSigs(aSolo), ...geomSigs(bSolo)].sort(),
		);
	});

	it("⛔ repeated reads are MEMOIZED — no re-merge, byte-identical copies", async () => {
		const shared = cellsFor(PIN_A[0], PIN_A[1]).filter((c) =>
			owns(c, cellsFor(PIN_B[0], PIN_B[1])),
		);
		const cell = shared[0];
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const first = await idbGetTileForAddress(cell.z, cell.ix, cell.iy);
			expect(first).not.toBeNull();
			for (let i = 0; i < 150; i++) {
				const again = await idbGetTileForAddress(cell.z, cell.ix, cell.iy);
				expect(again!.byteLength).toBe(first!.byteLength);
				expect(new Uint8Array(again!)).toEqual(new Uint8Array(first!));
			}
			// A broken memoization re-logs on every read.
			const merges = warn.mock.calls.filter((c) =>
				String(c[0]).includes("[roads] merged"),
			);
			expect(merges.length).toBeLessThanOrEqual(1);
		} finally {
			warn.mockRestore();
		}
	});

	it("a pin-ONLY address still returns that pin's blob alone", async () => {
		await storePinBlobs(PIN_A, "A");
		await storePinBlobs(PIN_B, "B");
		const aOnly = cellsFor(PIN_A[0], PIN_A[1]).filter(
			(c) => !owns(c, cellsFor(PIN_B[0], PIN_B[1])),
		);
		if (!aOnly.length) return;
		const cell = aOnly[0];
		const buf = await idbGetTileForAddress(cell.z, cell.ix, cell.iy);
		expect(buf).not.toBeNull();
		const roads = decode(buf!).layers.roads;
		expect(roads.length).toBe(2);
		for (let i = 0; i < roads.length; i++)
			expect(roads.feature(i).properties.owner).toBe("A");
	});
});


