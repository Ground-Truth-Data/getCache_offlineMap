// Failure must throw: an empty list reads as "no fires near you".

import { guardPackDownload } from "../../onPhone/store/downloadGuard";
import { firesUrl } from "../tilesHost";
import {
	FIRE_RADIUS_KM,
	type FireHotspot,
	type FireOutline,
} from "../../shared/fireContract";

const FIRE_TIMEOUT_MS = 20_000;

export interface FireFetchResult {
	/** The nearest fires (each with `n`) and the hotspots near the centre (each with `f`). */
	hotspots: FireHotspot[];
	outlines: FireOutline[];
	/** X-Radius-Km: smaller than asked when the nearest fires ran out first. */
	radiusKm: number;
	/** X-Fetched-At, not our clock, which overstates freshness by up to the cache TTL. */
	fetchedAt: number;
	/** X-Sources-Ok: satellites that reported, of three. */
	sourcesOk: number;
	/** Decompressed JSON size, ~13× the download; the wire size is unreadable here (gzip-streamed, no Content-Length). */
	bytes: number;
}

interface FireGeoJSON {
	type: string;
	features?: Array<{
		geometry?: { type?: string; coordinates?: unknown };
		properties?: {
			t?: number;
			c?: string;
			frp?: number;
			px?: number;
			dn?: string;
			f?: string;
			n?: number;
			a?: number;
			t0?: number;
			p?: [number, number][];
		};
	}>;
}

function toConfidence(raw: unknown): FireHotspot["c"] {
	return raw === "high" ? "high" : raw === "nominal" ? "nominal" : "low";
}

export async function fetchAreaFires(
	lng: number,
	lat: number,
	radiusKm: number = FIRE_RADIUS_KM,
): Promise<FireFetchResult> {
	guardPackDownload({ route: "fires", lng, lat, km: radiusKm });

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FIRE_TIMEOUT_MS);
	let res: Response;
	let text: string;
	const firesEndpoint = firesUrl();
	if (firesEndpoint === null) {
		clearTimeout(timer);
		throw new Error(
			"no tiles host configured — call configureTilesHost(<origin>) at app boot before fetching fires.",
		);
	}
	try {
		res = await fetch(
			`${firesEndpoint}?lng=${lng}&lat=${lat}&km=${Math.round(radiusKm)}`,
			{ signal: controller.signal },
		);
		if (!res.ok) {
			throw new Error(`fires endpoint responded ${res.status}`);
		}
		text = await res.text();
	} finally {
		clearTimeout(timer);
	}

	let parsed: FireGeoJSON;
	try {
		parsed = JSON.parse(text) as FireGeoJSON;
	} catch {
		throw new Error("fires endpoint returned a non-JSON body");
	}
	if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
		throw new Error("fires endpoint returned a malformed FeatureCollection");
	}

	const hotspots: FireHotspot[] = [];
	const outlines: FireOutline[] = [];
	for (const f of parsed.features) {
		if (f.geometry?.type === "Polygon") {
			const ring = (f.geometry.coordinates as [number, number][][])?.[0];
			if (Array.isArray(ring) && typeof f.properties?.f === "string") outlines.push({ f: f.properties.f, ring });
			continue;
		}
		const c = f.geometry?.coordinates as [number, number] | undefined;
		const t = f.properties?.t;
		if (!Array.isArray(c) || c.length !== 2) continue;
		if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
		if (typeof t !== "number" || !Number.isFinite(t)) continue;
		hotspots.push({
			coordinates: [c[0], c[1]],
			t,
			c: toConfidence(f.properties?.c),
			frp: Number.isFinite(f.properties?.frp) ? (f.properties?.frp as number) : 0,
			// Never default px to 0: "unknown" and "0" are different claims.
			...(Number.isFinite(f.properties?.px)
				? { px: f.properties?.px as number }
				: {}),
			...(f.properties?.dn === "D" || f.properties?.dn === "N"
				? { dn: f.properties.dn as "D" | "N" }
				: {}),
			...(typeof f.properties?.f === "string" ? { f: f.properties.f } : {}),
			...(Number.isFinite(f.properties?.n)
				? { n: f.properties?.n as number, a: f.properties?.a ?? 0, t0: f.properties?.t0 ?? t, p: f.properties?.p ?? [] }
				: {}),
		});
	}

	const headerAt = Number(res.headers.get("X-Fetched-At"));
	const sourcesOk = Number(res.headers.get("X-Sources-Ok"));
	const servedKm = Number(res.headers.get("X-Radius-Km"));

	return {
		hotspots,
		outlines,
		radiusKm: Number.isFinite(servedKm) && servedKm > 0 ? servedKm : radiusKm,
		fetchedAt: Number.isFinite(headerAt) && headerAt > 0 ? headerAt : Date.now(),
		sourcesOk: Number.isFinite(sourcesOk) && sourcesOk > 0 ? sourcesOk : 3,
		bytes: text.length,
	};
}
