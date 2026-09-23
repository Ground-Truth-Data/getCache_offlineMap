/**
 * Which blobs make room for the next one. Oldest wins the axe — the rule the
 * map has always had, now the one the walls actually enforce.
 *
 * Pure on purpose: the caller owns the disk, this owns the policy, so the rule
 * is testable without an IndexedDB. Two walls, because they answer different
 * questions — a thousand tiny blobs and one enormous one are both full.
 */

import { BLOB_COUNT_CAP } from "./budget";

/** What the policy reads off a blob. `Region` satisfies this. */
export interface Evictable {
	id: string;
	/** ms epoch — the age the axe sorts on */
	at: number;
	bytes: number;
}

export interface Room {
	/** bytes the incoming blob needs */
	adding: number;
	budget: number;
	/**
	 * Bytes on disk NOW, from the store that owns them. Passed in rather than
	 * summed from `have`, because a blob's row carries its size only once its
	 * download has finished sizing it — summing the rows reports a nearly
	 * empty disk mid-download and evicts nothing.
	 */
	used: number;
	cap?: number;
}

/**
 * The blobs to delete, oldest first, so `adding` fits under both walls.
 *
 * Returns empty when there is already room — and ALSO when no amount of
 * eviction would help, because a blob bigger than the whole budget is a
 * refusal, not a reason to strip the disk. The caller reports that refusal;
 * silently clearing the map to fail anyway is the worse outcome.
 */
export function toEvict<T extends Evictable>(
	have: readonly T[],
	{ adding, budget, used, cap = BLOB_COUNT_CAP }: Room,
): T[] {
	if (adding > budget) return [];

	let overBytes = used + adding - budget;
	// The incoming blob takes a slot, so the cap is measured against have + 1.
	let overCount = have.length + 1 - cap;
	if (overBytes <= 0 && overCount <= 0) return [];

	const oldest = [...have].sort((a, b) => a.at - b.at);
	const out: T[] = [];
	for (const r of oldest) {
		if (overBytes <= 0 && overCount <= 0) break;
		// An unsized row (`bytes: 0`, still downloading) frees nothing we can
		// count. Taking it would not move `overBytes`, so the loop would walk
		// the whole disk chasing a target it cannot reach — leave it be and
		// let the caller's refusal stand.
		if (overBytes > 0 && r.bytes === 0 && overCount <= 0) continue;
		out.push(r);
		overBytes -= r.bytes;
		overCount -= 1;
	}
	return out;
}
