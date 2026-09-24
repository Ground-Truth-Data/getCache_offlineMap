/**
 * Sweep of duplicate photos. Nothing is deleted unless a survivor covers the
 * same ground by `photoReusableFor`, the predicate the bake itself consults.
 */

import {
	dropCoverage,
	noteCoverage,
} from "../store/coverageRegistry";
import {
	deleteSatImage,
	photoReusableFor,
	satImageMeta,
} from "./satelliteImage";

export interface DedupPlan {
	drop: { key: string; coveredBy: string; bytes: number }[];
	keep: string[];
	bytes: number;
}

function centerOfKey(key: string): [number, number] | null {
	const [lng, lat] = key.split(",").map(Number);
	return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

/** What the sweep would do, no deletions. Greedy by size: the biggest photo loses the least detail. */
export async function planPhotoDedup(): Promise<DedupPlan> {
	const meta = (await satImageMeta())
		.map((m) => ({ ...m, center: centerOfKey(m.key) }))
		.filter((m): m is typeof m & { center: [number, number] } => !!m.center)
		.sort((a, b) => b.bytes - a.bytes);

	const keep: typeof meta = [];
	const drop: DedupPlan["drop"] = [];
	for (const m of meta) {
		const cover = keep.find((k) =>
			photoReusableFor(k.source, k.center, m.center),
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

/** Run the sweep. The record is patched, not dropped: the area keeps its road tiles. */
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

export async function dropAreaEntirely(areaKey: string): Promise<void> {
	await deleteSatImage(areaKey);
	await dropCoverage(areaKey);
}
