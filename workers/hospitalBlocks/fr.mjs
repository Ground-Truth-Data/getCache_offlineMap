// France: FINESS (t_finess on data.gouv.fr) replaces OSM inside the Natural
// Earth "France" feature. ER = activity 14 in the authorisations file OR
// san_urg=OUI; the authorisations file alone runs thin. Resource URLs are
// discovered through the dataset API because the static ones rot on refresh.

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

// Inpatient establishments only; the 1100 group's outpatient mental-health structures are not hospitals.
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

/** ET FINESS numbers holding activity 14 (Médecine d'urgence); rows are
 *  `activiteoffresoin;<EJ finess>;<EJ name>;<activity code>;…;<ET finess>;…`. */
export function parseActivity14(text) {
	const out = new Set();
	for (const line of text.split("\n")) {
		const f = line.split(";");
		if (f[0] === "activiteoffresoin" && f[3] === "14" && f[11]) out.add(f[11]);
	}
	return out;
}

/** ERs sort first so a same-coordinate collapse in the bake keeps the ER row. */
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
