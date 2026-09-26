import { makeKeyedIdbStore } from "./keyedIdbStore";

const DB_NAME = "rt-mapRegistry";
const STORE = "coverage";

export const OFFLINE_BUDGET_BYTES = 1024 * 1024 * 1024;

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

const idb = makeKeyedIdbStore<CoverageRecord>({
	dbName: DB_NAME,
	storeName: STORE,
});

export async function allCoverage(): Promise<CoverageRecord[]> {
	return idb.getAll();
}

export async function noteCoverage(
	areaKey: string,
	lng: number,
	lat: number,
	patch: { hasPhoto?: boolean; photoBytes?: number },
): Promise<void> {
	const prev = await idb.get(areaKey);
	const rec: CoverageRecord = {
		areaKey,
		lng,
		lat,
		hasPhoto: patch.hasPhoto ?? prev?.hasPhoto ?? false,
		hasLines: prev?.hasLines ?? false,
		bytes: prev?.bytes ?? 0,
		photoBytes: patch.photoBytes ?? prev?.photoBytes ?? 0,
		lineBytes: prev?.lineBytes ?? 0,
		lineCount: prev?.lineCount ?? 0,
		blobVersion: prev?.blobVersion,
		lastTouched: prev?.lastTouched ?? Date.now(),
	};
	await idb.put(rec.areaKey, rec);
}

export async function dropCoverage(areaKey: string): Promise<void> {
	await idb.delete(areaKey);
}
