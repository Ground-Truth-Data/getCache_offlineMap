/** The Worker's batch wire format: [uint32 LE manifestLen][manifest JSON {tiles:[{k,n}]}][tile bytes in manifest order]. `n: 0` is a tile the source lacks. */
export function readPack(buf: Uint8Array): Array<[string, ArrayBuffer | null]> {
	const len = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true);
	const { tiles } = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + len))) as {
		tiles: Array<{ k: string; n: number }>;
	};
	let off = 4 + len;
	return tiles.map(({ k, n }) => {
		if (n === 0) return [k, null];
		const b = buf.slice(off, off + n).buffer;
		off += n;
		return [k, b];
	});
}
