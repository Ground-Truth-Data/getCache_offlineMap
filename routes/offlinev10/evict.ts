/** Eviction policy, pure so it is testable without an IndexedDB. Two walls: a thousand tiny blobs and one enormous one are both full. */

import { BLOB_COUNT_CAP } from "./budget";

export interface Evictable {
	id: string;
	/** ms epoch */
	at: number;
	bytes: number;
}

export interface Room {
	adding: number;
	budget: number;
	/** From the store, not summed from `have`: a row carries its size only once its download is sized. */
	used: number;
	cap?: number;
}

/** Oldest first. Empty when a blob bigger than the whole budget could never fit: a refusal, not a reason to strip the disk. */
export function toEvict<T extends Evictable>(
	have: readonly T[],
	{ adding, budget, used, cap = BLOB_COUNT_CAP }: Room,
): T[] {
	if (adding > budget) return [];

	let overBytes = used + adding - budget;
	let overCount = have.length + 1 - cap;
	if (overBytes <= 0 && overCount <= 0) return [];

	const oldest = [...have].sort((a, b) => a.at - b.at);
	const out: T[] = [];
	for (const r of oldest) {
		if (overBytes <= 0 && overCount <= 0) break;
		// An unsized row would not move `overBytes`; the loop would walk the whole disk.
		if (overBytes > 0 && r.bytes === 0 && overCount <= 0) continue;
		out.push(r);
		overBytes -= r.bytes;
		overCount -= 1;
	}
	return out;
}
