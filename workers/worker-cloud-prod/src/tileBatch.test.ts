import { expect, it } from "vitest";
import { buildTileBatch } from "./tileBatch";

const get = async (z: number, x: number, y: number) => (x === 9 ? null : new Uint8Array([z, x, y]).buffer);

it("answers many tiles in one buffer, in request order, with a lacking tile as n:0", async () => {
	const buf = new Uint8Array(await buildTileBatch(get, [[1, 2, 3], [4, 9, 6], [7, 8, 9]]));
	const len = new DataView(buf.buffer).getUint32(0, true);
	const manifest = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + len)));
	expect(manifest).toEqual({
		total: 3,
		empty: 1,
		tiles: [{ k: "1/2/3", n: 3 }, { k: "4/9/6", n: 0 }, { k: "7/8/9", n: 3 }],
	});
	expect([...buf.subarray(4 + len)]).toEqual([1, 2, 3, 7, 8, 9]);
});
