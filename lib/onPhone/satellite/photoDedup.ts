/**
 * photoDedup — a ONE-TIME sweep for photos baked before the reuse rule existed.
 *
 * The key dedups at ~11 m; a photo covers 2 km. Before `photoCovering`, every
 * pin metres from its neighbour minted its own near-identical photo, so a
 * stand of Quality 704 plots left dozens of copies of one piece of ground on
 * disk. The reuse rule stops NEW duplicates; it cannot reach the ones already
 * there.
 *
 * WHAT IT KEEPS: for each cluster, the photo that covers the most ground and
 * has the best source — never the first one found. Nothing is deleted unless a
 * survivor genuinely covers the same ground, so a sweep can never leave an
 * area blank. Plot photos have no survivor requirement: a plot earns no photo
 * at all now, so its copies go.
 */

import {
	dropCoverage,
	noteCoverage,
} from "../store/coverageRegistry";
import { kmBetween } from "../../shared/kmGeo";
import {
	deleteSatImage,
	PHOTO_REUSE_KM,
	satImageMeta,
} from "./satelliteImage";

export interface DedupPlan {
	/** keys that would be deleted, each with the key that covers it instead */
	drop: { key: string; coveredBy: string; bytes: number }[];
	keep: string[];
	bytes: number;
}

function centerOfKey(key: string): [number, number] | null {
	const [lng, lat] = key.split(",").map(Number);
	return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

/**
 * What the sweep WOULD do — no deletions. The dock calls this first so a
 * number can be shown before anything is destroyed.
 *
 * Greedy by size: the biggest photo in a cluster is the one baked at the
 * widest canvas, so keeping it loses the least detail.
 */
export async function planPhotoDedup(): Promise<DedupPlan> {
	const meta = (await satImageMeta())
		.map((m) => ({ ...m, center: centerOfKey(m.key) }))
		.filter((m): m is typeof m & { center: [number, number] } => !!m.center)
		.sort((a, b) => b.bytes - a.bytes);

	const keep: typeof meta = [];
	const drop: DedupPlan["drop"] = [];
	for (const m of meta) {
		const cover = keep.find(
			(k) => kmBetween(k.center, m.center) <= PHOTO_REUSE_KM,
		);
		if (cover) drop.push({ key: m.key, coveredBy: cover.key, bytes: m.bytes });
		else keep.push(m);
	}
	return {
		drop,
		keep: keep.map((k) => k.key),
		bytes: drop.reduce((s, d) => s + d.bytes, 0),
	};
}

/**
 * Run the sweep. Returns the bytes actually freed.
 *
 * The budget record is patched, not dropped: the area keeps its ROAD tiles and
 * its row — only the photo half is cleared. Dropping the record would orphan
 * the tiles from the budget and the space would never come back.
 */
export async function runPhotoDedup(): Promise<DedupPlan> {
	const plan = await planPhotoDedup();
	for (const d of plan.drop) {
		await deleteSatImage(d.key);
		const c = centerOfKey(d.key);
		if (c)
			await noteCoverage(d.key, c[0], c[1], {
				hasPhoto: false,
				photoBytes: 0,
			});
	}
	console.info(
		`[offline] photo dedup — ${plan.drop.length} duplicate photos removed, ${(plan.bytes / 1048576).toFixed(1)} MB freed, ${plan.keep.length} kept`,
	);
	return plan;
}

/** Named so a caller that has already deleted an area's TILES can clear the whole record. */
export async function dropAreaEntirely(areaKey: string): Promise<void> {
	await deleteSatImage(areaKey);
	await dropCoverage(areaKey);
}
