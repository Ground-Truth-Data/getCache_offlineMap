// France block — the national FINESS registry replaces every OSM row inside
// the Natural Earth "France" feature (métropole + overseas départements).
//
// Facilities: Atlasanté « Référentiel Finess (t_finess) » on data.gouv.fr —
// ships WGS84 coordinates (geoloc_4326_*) plus a precision field directly.
// ER flag: « FINESS Extraction des autorisations d'activités de soin »,
// activity 14 = Médecine d'urgence, joined by ET FINESS number — OR'd with
// t_finess's own san_urg column, because the legacy stock file runs thin
// (471 ETs vs 668 san_urg=OUI on 2026-09-01; both are the registry stating
// "has urgences", so the row rules require carrying either through). The
// legacy extraction's successor is the FINESS+ daily flow at
// github.com/ansforge/finess. No authorisation anywhere → null (unknown),
// never "no".
//
// Resource URLs are discovered through the data.gouv.fr dataset API each cold
// run — the static URLs carry an upload timestamp and rot on refresh.

import {
	BLOCKS_CACHE,
	cachedDownload,
	colIndex,
	makeEntry,
	parseCsv,
} from "./lib.mjs";
import { countryContains } from "./countries.mjs";

export const countryCode = "FR";
export const source =
	"Atlasanté « Référentiel Finess (t_finess) » + FINESS autorisations d'activités de soin — data.gouv.fr, Licence Ouverte (attribution), fetched 2026-09-01";

export async function bounds() {
	return countryContains("France");
}

// FINESS categories kept: every categ_lib that reads as a hospital / inpatient
// care establishment, mirroring OSM's amenity=hospital breadth. The niv2 1100
// « Etablissements Hospitaliers » group also holds outpatient mental-health
// structures (CMP, CATTP, ateliers/appartements thérapeutiques, postcure…) —
// those are not hospitals and are not kept.
export const HOSPITAL_CATEGORIES = new Set([
	"101", // Centre Hospitalier Régional (C.H.R.)
	"106", // Centre hospitalier, ex Hôpital local
	"109", // Etablissement de santé privé autorisé en SSR
	"114", // Hôpital des armées
	"115", // Etablissement de Soins du Service de Santé des Armées
	"122", // Etablissement Soins Obstétriques Chirurgico-Gynécologiques
	"128", // Etablissement de Soins Chirurgicaux
	"129", // Etablissement de Soins Médicaux
	"131", // Centre de Lutte Contre Cancer
	"292", // Centre Hospitalier Spécialisé lutte Maladies Mentales
	"355", // Centre Hospitalier (C.H.)
	"362", // Etablissement de Soins Longue Durée
	"365", // Etablissement de Soins Pluridisciplinaire
	"697", // Groupement de coopération sanitaire - Etablissement de santé (6 hold ER authorisations)
]);

/** ET FINESS numbers holding activity 14 (Médecine d'urgence). The file is
 *  semicolon-separated, sectioned by a row-type first field; activity rows are
 *  `activiteoffresoin;<EJ finess>;<EJ name>;<activity code>;…;<ET finess>;…`. */
export function parseActivity14(text) {
	const out = new Set();
	for (const line of text.split("\n")) {
		const f = line.split(";");
		if (f[0] === "activiteoffresoin" && f[3] === "14" && f[11]) out.add(f[11]);
	}
	return out;
}

/** t_finess CSV → canonical entries, filtered per the row rules. ERs sort
 *  first so a same-coordinate collapse in the bake keeps the ER row (286 rows
 *  only geolocate to the mairie, stacking a town's facilities on one point). */
export function parseFiness(csvText, activity14) {
	const rows = parseCsv(csvText);
	const col = colIndex(rows[0], [
		"finess",
		"etat",
		"type",
		"rs",
		"telephone",
		"categ_code",
		"san_urg",
		"geoloc_4326_long",
		"geoloc_4326_lat",
	]);
	const entries = [];
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i];
		if (r[col.etat] !== "ACTUEL" || r[col.type] !== "ET") continue;
		if (!HOSPITAL_CATEGORIES.has(r[col.categ_code])) continue;
		const lng = Number(r[col.geoloc_4326_long]);
		const lat = Number(r[col.geoloc_4326_lat]);
		if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
		const emergency =
			activity14.has(r[col.finess]) || r[col.san_urg] === "OUI" ? "yes" : null;
		const phone = (r[col.telephone] ?? "").trim();
		entries.push(
			makeEntry(lng, lat, r[col.rs].trim() || "Hospital", emergency, phone || undefined),
		);
	}
	entries.sort((a, b) => (b[3] === "yes") - (a[3] === "yes"));
	return entries;
}

async function resourceUrl(slug) {
	const api = `https://www.data.gouv.fr/api/1/datasets/${slug}/`;
	const res = await globalThis.fetch(api);
	if (!res.ok) throw new Error(`${api}: HTTP ${res.status}`);
	const { resources } = await res.json();
	const r = resources.find((x) => x.format === "csv");
	if (!r) throw new Error(`${slug}: no CSV resource`);
	return r.url;
}

export async function fetch() {
	const dir = `${BLOCKS_CACHE}fr/`;
	const [facilities, auth] = await Promise.all([
		cachedDownload(
			() => resourceUrl("referentiel-finess-t-finess"),
			`${dir}t-finess.csv`,
		),
		cachedDownload(
			() => resourceUrl("finess-extraction-des-autorisations-dactivites-de-soin"),
			`${dir}autorisations.csv`,
		),
	]);
	return parseFiness(facilities, parseActivity14(auth));
}
