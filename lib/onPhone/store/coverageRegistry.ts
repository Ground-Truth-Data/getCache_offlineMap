import { makeKeyedIdbStore } from "./keyedIdbStore";

const DB_NAME = "rt-mapRegistry";
const STORE = "coverage";

/** LRU-evicted over this. */
export const OFFLINE_BUDGET_BYTES = 1024 * 1024 * 1024;

/** Per-area byte estimate for areas not yet downloaded (~3.2 MB photo + line pack). */
export const EST_AREA_BYTES = 3.5 * 1024 * 1024;

export interface CoverageRecord {
	areaKey: string;
	lng: number;
	lat: number;
	hasPhoto: boolean;
	hasLines: boolean;
	bytes: number;
	photoBytes?: number;
	lineBytes?: number;
	lineCount?: number;
	/** Geometry signature at build; a mismatch or undefined means STALE — re-download. */
	blobVersion?: string;
	/** Last successful download; distinct from lastTouched. */
	bakedAt?: number;
	lastTouched: number;
}

// ⚠️ Naive mirroring re-serialized the whole store every 20s and wedged app boot; re-enable only with a throttled, off-boot write path.
const COVERAGE_MIRROR_ENABLED = false;

export interface CoverageMirror {
	write(rec: CoverageRecord): Promise<void>;
	remove(areaKey: string): Promise<void>;
}
let coverageMirror: CoverageMirror | null = null;

export function setCoverageMirror(m: CoverageMirror | null): void {
	coverageMirror = m;
}
async function mirrorToTinyBase(rec: CoverageRecord): Promise<void> {
	if (!COVERAGE_MIRROR_ENABLED) return;
	try {
		await coverageMirror?.write(rec);
	} catch {
		// codestyle-allow-swallow: the registry is the source of truth; a failed cloud-mirror write must not break baking
	}
}
async function unmirrorFromTinyBase(areaKey: string): Promise<void> {
	if (!COVERAGE_MIRROR_ENABLED) return;
	try {
		await coverageMirror?.remove(areaKey);
	} catch {
		// codestyle-allow-swallow: mirror cleanup is best-effort
	}
}

const idb = makeKeyedIdbStore<CoverageRecord>({
	dbName: DB_NAME,
	storeName: STORE,
});

export async function backfillCoverageMirror(): Promise<void> {
	if (!COVERAGE_MIRROR_ENABLED) return;
	try {
		const recs = await allCoverage();
		for (const r of recs) await mirrorToTinyBase(r);
	} catch {
		// codestyle-allow-swallow: mirror backfill is best-effort; the registry stays authoritative
	}
}

export async function allCoverage(): Promise<CoverageRecord[]> {
	return idb.getAll();
}

/** Sets lastTouched: touchAt (verbatim) > touch (now) > prior stamp — a no-op re-bake must not reset recency. */
export async function noteCoverage(
	areaKey: string,
	lng: number,
	lat: number,
	patch: {
		bakedAt?: number;
		hasPhoto?: boolean;
		hasLines?: boolean;
		bytes?: number;
		photoBytes?: number;
		lineBytes?: number;
		lineCount?: number;
		blobVersion?: string;
	},
	touch = false,
	touchAt?: number,
): Promise<void> {
	const prev = await idb.get(areaKey);
	const lastTouched = Number.isFinite(touchAt)
		? (touchAt as number)
		: touch
			? Date.now()
			: (prev?.lastTouched ?? Date.now());
	const rec: CoverageRecord = {
		areaKey,
		lng,
		lat,
		hasPhoto: patch.hasPhoto ?? prev?.hasPhoto ?? false,
		hasLines: patch.hasLines ?? prev?.hasLines ?? false,
		bytes: patch.bytes ?? prev?.bytes ?? 0,
		photoBytes: patch.photoBytes ?? prev?.photoBytes ?? 0,
		lineBytes: patch.lineBytes ?? prev?.lineBytes ?? 0,
		lineCount: patch.lineCount ?? prev?.lineCount ?? 0,
		blobVersion: patch.blobVersion ?? prev?.blobVersion,
		lastTouched,
	};
	await idb.put(rec.areaKey, rec);
	void mirrorToTinyBase(rec);
}

export async function dropCoverage(areaKey: string): Promise<void> {
	await idb.delete(areaKey);
	void unmirrorFromTinyBase(areaKey);
}

// Eviction lives in offlineBakeService.bakeAll(): a registry-only one can't see orphan blobs.
