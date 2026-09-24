const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

// MODIS excluded: its 0–100 confidence scale does not match VIIRS l/n/h.
export const FIRMS_SOURCES = [
	"VIIRS_NOAA20_NRT",
	"VIIRS_SNPP_NRT",
	"VIIRS_NOAA21_NRT",
] as const;

// Never below 2: DAY_RANGE=1 means "today, UTC", not "last 24h", and blanks the layer at UTC midnight.
export const DAY_RANGE = 2;

export const DEFAULT_RADIUS_KM = 500;

export const MAX_RADIUS_KM = 800;

export type FireConfidence = "low" | "nominal" | "high";

export interface FireFeature {
	/** [lng, lat], GeoJSON order, not the CSV's lat-first. */
	readonly coordinates: readonly [number, number];
	/** acquisition time, UTC epoch ms */
	readonly t: number;
	readonly confidence: FireConfidence;
	/** fire radiative power, MW */
	readonly frp: number;
	/** pixel footprint km (max of scan/track) */
	readonly px?: number;
	readonly dn?: "D" | "N";
}

export interface FireCollection {
	readonly type: "FeatureCollection";
	readonly features: ReadonlyArray<{
		readonly type: "Feature";
		readonly geometry: { readonly type: "Point"; readonly coordinates: readonly [number, number] };
		readonly properties: {
			readonly t: number;
			readonly c: FireConfidence;
			readonly frp: number;
			readonly px?: number;
			readonly dn?: "D" | "N";
		};
	}>;
}

const EARTH_RADIUS_KM = 6371;

export function bboxForRadius(
	lng: number,
	lat: number,
	km: number,
): [number, number, number, number] {
	const latDelta = (km / EARTH_RADIUS_KM) * (180 / Math.PI);
	const cosLat = Math.cos((lat * Math.PI) / 180);
	const lngDelta = Math.abs(cosLat) < 0.01 ? 180 : latDelta / cosLat;
	return [
		Math.max(-180, lng - lngDelta),
		Math.max(-90, lat - latDelta),
		Math.min(180, lng + lngDelta),
		Math.min(90, lat + latDelta),
	];
}

export function distanceKm(
	aLng: number,
	aLat: number,
	bLng: number,
	bLat: number,
): number {
	const toRad = Math.PI / 180;
	const dLat = (bLat - aLat) * toRad;
	const dLng = (bLng - aLng) * toRad;
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Unknown codes are the weakest reading, never promoted.
function parseConfidence(raw: string): FireConfidence {
	switch (raw.trim().toLowerCase()) {
		case "h":
		case "high":
			return "high";
		case "n":
		case "nominal":
			return "nominal";
		default:
			return "low";
	}
}

/** Date.UTC from explicit parts: ISO-string slicing shifts the day in local time. */
export function parseAcqTime(acqDate: string, acqTime: string): number {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(acqDate.trim());
	if (m === null) return Number.NaN;
	const hhmm = acqTime.trim().padStart(4, "0");
	const hours = Number(hhmm.slice(0, 2));
	const mins = Number(hhmm.slice(2, 4));
	if (!Number.isFinite(hours) || !Number.isFinite(mins)) return Number.NaN;
	return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hours, mins);
}

/** Columns are read by header name: a reordered feed would silently poison every coordinate. */
export function parseFiresCsv(
	csv: string,
	centreLng: number,
	centreLat: number,
	radiusKm: number,
): FireFeature[] {
	const lines = csv.trim().split("\n");
	if (lines.length < 2) return [];

	const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
	const col = (name: string): number => {
		const i = header.indexOf(name);
		if (i === -1) {
			throw new Error(
				`FIRMS CSV missing expected column "${name}" — header was: ${header.join(",")}`,
			);
		}
		return i;
	};
	const iLat = col("latitude");
	const iLng = col("longitude");
	const iDate = col("acq_date");
	const iTime = col("acq_time");
	const iConf = col("confidence");
	const iFrp = col("frp");
	// Optional columns: a feed missing them degrades the popup, never blanks the layer.
	const soft = (name: string): number => header.indexOf(name);
	const iScan = soft("scan");
	const iTrack = soft("track");
	const iDayNight = soft("daynight");

	const out: FireFeature[] = [];
	for (let i = 1; i < lines.length; i++) {
		const row = lines[i].trim();
		if (row === "") continue;
		const f = row.split(",");
		const lat = Number(f[iLat]);
		const lng = Number(f[iLng]);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
		// Trim the bbox to a disc; corners reach 40% past the radius.
		if (distanceKm(centreLng, centreLat, lng, lat) > radiusKm) continue;
		const t = parseAcqTime(f[iDate] ?? "", f[iTime] ?? "");
		if (!Number.isFinite(t)) continue;
		const frp = Number(f[iFrp]);
		const scan = iScan === -1 ? Number.NaN : Number(f[iScan]);
		const track = iTrack === -1 ? Number.NaN : Number(f[iTrack]);
		const px =
			Number.isFinite(scan) && Number.isFinite(track)
				? Math.round(Math.max(scan, track) * 10) / 10
				: undefined;
		const dn = iDayNight === -1 ? "" : (f[iDayNight] ?? "").trim().toUpperCase();
		out.push({
			coordinates: [lng, lat],
			t,
			confidence: parseConfidence(f[iConf] ?? ""),
			frp: Number.isFinite(frp) ? frp : 0,
			...(px === undefined ? {} : { px }),
			...(dn === "D" || dn === "N" ? { dn: dn as "D" | "N" } : {}),
		});
	}
	return out;
}

/** Same ~375 m cell within the same hour keeps the strongest FRP. */
export function dedupeFires(features: readonly FireFeature[]): FireFeature[] {
	const best = new Map<string, FireFeature>();
	for (const f of features) {
		const key = [
			f.coordinates[0].toFixed(3),
			f.coordinates[1].toFixed(3),
			Math.floor(f.t / 3_600_000),
		].join("|");
		const prev = best.get(key);
		if (prev === undefined || f.frp > prev.frp) best.set(key, f);
	}
	return [...best.values()];
}

export function firmsUrl(
	mapKey: string,
	source: string,
	bbox: readonly [number, number, number, number],
	days: number = DAY_RANGE,
): string {
	const area = bbox.map((n) => n.toFixed(4)).join(",");
	return `${FIRMS_BASE}/${mapKey}/${source}/${area}/${days}`;
}

/** Throws when every source fails: an empty collection lies as "no fires near you". */
export async function fetchFires(
	mapKey: string,
	lng: number,
	lat: number,
	radiusKm: number,
	fetchImpl: typeof fetch = fetch,
): Promise<{ collection: FireCollection; sourcesOk: number; fetchedAt: number }> {
	const bbox = bboxForRadius(lng, lat, radiusKm);

	const results = await Promise.allSettled(
		FIRMS_SOURCES.map(async (source) => {
			const res = await fetchImpl(firmsUrl(mapKey, source, bbox));
			if (!res.ok) {
				throw new Error(`FIRMS ${source} responded ${res.status}`);
			}
			const body = await res.text();
			// A bad or over-quota key returns 200 with an HTML body.
			if (body.trimStart().startsWith("<") || !body.includes("latitude")) {
				throw new Error(
					`FIRMS ${source} returned a non-CSV body (bad key or quota?)`,
				);
			}
			return parseFiresCsv(body, lng, lat, radiusKm);
		}),
	);

	const ok = results.filter(
		(r): r is PromiseFulfilledResult<FireFeature[]> => r.status === "fulfilled",
	);
	if (ok.length === 0) {
		const why = results
			.map((r) => (r.status === "rejected" ? String(r.reason) : ""))
			.filter(Boolean)
			.join("; ");
		throw new Error(`all FIRMS sources failed: ${why}`);
	}

	const merged = dedupeFires(ok.flatMap((r) => r.value));
	return {
		collection: {
			type: "FeatureCollection",
			features: merged.map((f) => ({
				type: "Feature" as const,
				geometry: { type: "Point" as const, coordinates: f.coordinates },
				// Absent means "feed didn't say"; never null.
				properties: {
					t: f.t,
					c: f.confidence,
					frp: f.frp,
					...(f.px === undefined ? {} : { px: f.px }),
					...(f.dn === undefined ? {} : { dn: f.dn }),
				},
			})),
		},
		sourcesOk: ok.length,
		fetchedAt: Date.now(),
	};
}
