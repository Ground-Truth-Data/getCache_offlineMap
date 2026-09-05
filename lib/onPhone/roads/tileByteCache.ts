/** A merged (or solo) tile per address; `owners` = the pin keys that produced `buf`. */
export interface CachedTile {
    owners: string[];
    buf: ArrayBuffer;
}

/**
 * LRU of merged tile bytes, capped by BYTES. A z8 address merges up to 16
 * cells at full detail (~25 MB), so a count cap was no cap at all: 512
 * entries held most of the disk's roads on the main thread (5 Sep 2026).
 * Insertion order is recency: a hit is re-inserted, eviction pops the head.
 */
export class TileByteCache {
    private readonly entries = new Map<string, CachedTile>();
    private held = 0;

    constructor(private readonly maxBytes: number) {}

    get(addr: string): CachedTile | undefined {
        const hit = this.entries.get(addr);
        if (!hit) return undefined;
        this.entries.delete(addr);
        this.entries.set(addr, hit);
        return hit;
    }

    set(addr: string, owners: string[], buf: ArrayBuffer): void {
        this.delete(addr);
        this.entries.set(addr, { owners, buf });
        this.held += buf.byteLength;
        for (const [k, v] of this.entries) {
            if (this.held <= this.maxBytes || k === addr) break;
            this.entries.delete(k);
            this.held -= v.buf.byteLength;
        }
    }

    delete(addr: string): void {
        const old = this.entries.get(addr);
        if (!old) return;
        this.entries.delete(addr);
        this.held -= old.buf.byteLength;
    }

    clear(): void {
        this.entries.clear();
        this.held = 0;
    }

    get size(): number {
        return this.entries.size;
    }

    get bytes(): number {
        return this.held;
    }
}
