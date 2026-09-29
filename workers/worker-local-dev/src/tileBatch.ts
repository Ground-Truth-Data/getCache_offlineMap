import type { PMTiles } from "pmtiles";

/** Tiles one request may ask for: each is an R2 read, and a Worker invocation has a subrequest ceiling. */
export const MAX_BATCH = 800;

// R2 reads in flight: /pack found 8 too slow and 100 over the 128 MB Worker limit.
const POOL = 32;

/**
 * Raw tiles from one archive in the /pack wire format, so one decoder reads both:
 * [uint32 LE manifestByteLen][manifest JSON {total, empty, tiles:[{k:"z/x/y", n}]}][tile bytes, in manifest order].
 * A tile the archive lacks is `n: 0` (the single-tile route's 204).
 */
export async function buildTileBatch(
  archive: Pick<PMTiles, "getZxy">,
  keys: ReadonlyArray<readonly [z: number, x: number, y: number]>,
): Promise<ArrayBuffer> {
  const bodies = new Array<ArrayBuffer | null>(keys.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const i = next++;
      const [z, x, y] = keys[i];
      bodies[i] = (await archive.getZxy(z, x, y))?.data ?? null;
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, keys.length) }, worker));

  const tiles = keys.map(([z, x, y], i) => ({ k: `${z}/${x}/${y}`, n: bodies[i]?.byteLength ?? 0 }));
  const manifest = new TextEncoder().encode(
    JSON.stringify({ total: tiles.length, empty: tiles.filter((t) => t.n === 0).length, tiles }),
  );
  const out = new Uint8Array(4 + manifest.byteLength + tiles.reduce((n, t) => n + t.n, 0));
  new DataView(out.buffer).setUint32(0, manifest.byteLength, true);
  out.set(manifest, 4);
  let off = 4 + manifest.byteLength;
  for (const b of bodies) {
    if (b === null) continue;
    out.set(new Uint8Array(b), off);
    off += b.byteLength;
  }
  return out.buffer;
}
