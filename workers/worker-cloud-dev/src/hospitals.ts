// Hospitals are read from the bundled hospitalsWorld.v*.bin (baked by
// bakeHospitals.mjs), not planet.pmtiles: they only materialise in its z15
// tiles (~200k reads per disc) and the pois layer drops the emergency tag.

export const HOSPITAL_RADIUS_KM = 200;
/** The map's own wall; a bigger ask is a bug, not a bigger answer. */
export const HOSPITAL_MAX_KM = 500;

/** Pack format: [uint32 LE indexLen][index JSON][cell JSON blobs]. Cell offsets
 *  are relative to the first byte after the index; a cell is an array of
 *  [lng, lat, name, emergency?, phone?] with trailing nulls trimmed. */
export interface HospitalsIndex {
  v: number;
  /** Degrees per grid cell; keys "cy_cx". */
  cellDeg: number;
  count: number;
  generated: string;
  cells: Record<string, [number, number]>;
}

export type HospitalEntry =
  | [number, number, string]
  | [number, number, string, string | null]
  | [number, number, string, string | null, string];

/** Throws on a malformed pack rather than answering empty. */
export function parseHospitalsPack(pack: ArrayBuffer): {
  index: HospitalsIndex;
  dataOrigin: number;
} {
  const indexLen = new DataView(pack).getUint32(0, true);
  const index = JSON.parse(
    new TextDecoder().decode(new Uint8Array(pack, 4, indexLen)),
  ) as HospitalsIndex;
  if (!index.cellDeg || !index.cells) {
    throw new Error("hospitals pack: malformed index");
  }
  return { index, dataOrigin: 4 + indexLen };
}

export function readCellEntries(
  pack: ArrayBuffer,
  dataOrigin: number,
  span: [number, number],
): HospitalEntry[] {
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(pack, dataOrigin + span[0], span[1])),
  ) as HospitalEntry[];
}

/** Grid keys whose cells can intersect the disc; wraps the antimeridian. */
export function cellKeysForDisc(
  lng: number,
  lat: number,
  cellDeg: number,
  radiusKm: number,
): string[] {
  const latDeg = radiusKm / 111.32;
  const s = Math.max(-90, lat - latDeg);
  const n = Math.min(90, lat + latDeg);
  // The disc's widest parallel decides the lng span; the centre's latitude under-covers poleward.
  const cosMin = Math.min(
    Math.cos((s * Math.PI) / 180),
    Math.cos((n * Math.PI) / 180),
  );
  const lngDeg = cosMin > 1e-6 ? Math.min(180, radiusKm / (111.32 * cosMin)) : 180;
  const cols = Math.ceil(360 / cellDeg);
  const maxCy = Math.ceil(180 / cellDeg) - 1;
  const cy0 = Math.max(0, Math.floor((s + 90) / cellDeg));
  const cy1 = Math.min(maxCy, Math.floor((n + 90) / cellDeg));
  const cx0 = Math.floor((lng - lngDeg + 180) / cellDeg);
  const cx1 = Math.floor((lng + lngDeg + 180) / cellDeg);
  const keys = new Set<string>();
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      keys.add(`${cy}_${((cx % cols) + cols) % cols}`);
    }
  }
  return [...keys];
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface HospitalFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { name: string; emergency?: string; phone?: string };
}

/** Every hospital within the radius. `emergency` is omitted when unknown, so the
 *  UI may badge on it but must never filter to ER-only. */
export function hospitalsCollection(
  cellArrays: HospitalEntry[][],
  lng: number,
  lat: number,
  km: number = HOSPITAL_RADIUS_KM,
): { type: "FeatureCollection"; features: HospitalFeature[] } {
  const features: HospitalFeature[] = [];
  for (const entries of cellArrays) {
    for (const e of entries) {
      if (haversineKm(lat, lng, e[1], e[0]) > km) continue;
      const properties: HospitalFeature["properties"] = { name: e[2] };
      if (e.length > 3 && typeof e[3] === "string") properties.emergency = e[3];
      if (e.length > 4 && typeof e[4] === "string") properties.phone = e[4];
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e[0], e[1]] },
        properties,
      });
    }
  }
  return { type: "FeatureCollection", features };
}
