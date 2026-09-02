import { describe, expect, it } from "vitest";
import { colIndex, makeEntry, parseCsv } from "../../hospitalBlocks/lib.mjs";
import { featureTester, inRing } from "../../hospitalBlocks/countries.mjs";
import { parseActivity14, parseFiness } from "../../hospitalBlocks/fr.mjs";
import { parseBatchGeocode, parseCms } from "../../hospitalBlocks/us.mjs";

// Fixture strings only — the adapters' fetch() paths hit the network/cache and
// are exercised by the bake itself, not here.

describe("lib.parseCsv", () => {
	it("handles quoted delimiters, escaped quotes, embedded newlines, CRLF, BOM", () => {
		const text = '\uFEFFa,b\r\n"x,1","say ""hi"""\r\n"multi\nline",z\n';
		expect(parseCsv(text)).toEqual([
			["a", "b"],
			["x,1", 'say "hi"'],
			["multi\nline", "z"],
		]);
	});

	it("takes a custom delimiter", () => {
		expect(parseCsv("a;b\nc;d", ";")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
	});

	it("colIndex throws on a missing column instead of shipping garbage", () => {
		expect(() => colIndex(["a", "b"], ["a", "nope"])).toThrow(/nope/);
	});
});

describe("lib.makeEntry", () => {
	it("trims trailing null/absent fields so old-shape entries stay valid", () => {
		expect(makeEntry(2.35, 48.86, "Hôtel-Dieu")).toEqual([2.35, 48.86, "Hôtel-Dieu"]);
		expect(makeEntry(2.35, 48.86, "H", "yes")).toEqual([2.35, 48.86, "H", "yes"]);
	});

	it("keeps a null emergency only as a placeholder before a phone", () => {
		expect(makeEntry(2.35, 48.86, "H", null, "0142348234")).toEqual([
			2.35, 48.86, "H", null, "0142348234",
		]);
		expect(makeEntry(2.35, 48.86, "H", null)).toEqual([2.35, 48.86, "H"]);
	});

	it("rounds coordinates to 5 decimal places", () => {
		expect(makeEntry(2.123456789, 48.987654321, "H")).toEqual([2.12346, 48.98765, "H"]);
	});
});

describe("countries containment", () => {
	const square = [
		[0, 0],
		[10, 0],
		[10, 10],
		[0, 10],
		[0, 0],
	];
	const hole = [
		[4, 4],
		[6, 4],
		[6, 6],
		[4, 6],
		[4, 4],
	];

	it("inRing ray-casts even-odd", () => {
		expect(inRing(5, 5, square)).toBe(true);
		expect(inRing(15, 5, square)).toBe(false);
	});

	it("featureTester counts holes out and spans multipolygons", () => {
		const far = [
			[20, 20],
			[22, 20],
			[22, 22],
			[20, 22],
			[20, 20],
		];
		const contains = featureTester({
			geometry: { type: "MultiPolygon", coordinates: [[square, hole], [far]] },
		});
		expect(contains(2, 2)).toBe(true);
		expect(contains(5, 5)).toBe(false); // in the hole
		expect(contains(21, 21)).toBe(true); // second polygon
		expect(contains(30, 30)).toBe(false);
	});
});

describe("fr adapter parsing", () => {
	const finessHeader =
		"finess,etat,type,rs,telephone,categ_code,san_urg,geoloc_4326_long,geoloc_4326_lat";
	const row = (f) =>
		[f.finess, f.etat ?? "ACTUEL", f.type ?? "ET", f.rs, f.tel ?? "", f.cat ?? "355", f.urg ?? ".", f.lng ?? "2.35", f.lat ?? "48.86"].join(",");

	it("parseActivity14 collects ET finess numbers for Médecine d'urgence only", () => {
		const text = [
			"finess;etalab;111;2026-05-12",
			"structureet;010000024;010780054",
			"activiteoffresoin;010780054;CH FLEYRIAT;14;Médecine d'urgence;m;ml;f;fl;n;2000-01-01;010000024;CH DE FLEYRIAT",
			"activiteoffresoin;010780054;CH FLEYRIAT;01;Médecine;m;ml;f;fl;n;2000-01-01;010000024;CH DE FLEYRIAT",
		].join("\n");
		expect(parseActivity14(text)).toEqual(new Set(["010000024"]));
	});

	it("keeps ACTUEL ET hospital categories; drops EJ, OBSOLETE, other categories", () => {
		const csv = [
			finessHeader,
			row({ finess: "1", rs: "CH KEEP" }),
			row({ finess: "2", rs: "EJ SKIP", type: "EJ" }),
			row({ finess: "3", rs: "DEAD SKIP", etat: "OBSOLETE" }),
			row({ finess: "4", rs: "CMP SKIP", cat: "156" }),
			row({ finess: "5", rs: "NO COORDS", lng: "", lat: "" }),
		].join("\n");
		const entries = parseFiness(csv, new Set());
		expect(entries.map((e) => e[2])).toEqual(["CH KEEP"]);
	});

	it("flags emergency from activity 14 OR san_urg, else null; phone rides", () => {
		const csv = [
			finessHeader,
			row({ finess: "1", rs: "VIA ACTIVITY", tel: "0474454647" }),
			row({ finess: "2", rs: "VIA SAN_URG", urg: "OUI" }),
			row({ finess: "3", rs: "UNKNOWN" }),
		].join("\n");
		const entries = parseFiness(csv, new Set(["1"]));
		const byName = Object.fromEntries(entries.map((e) => [e[2], e]));
		expect(byName["VIA ACTIVITY"]).toEqual([2.35, 48.86, "VIA ACTIVITY", "yes", "0474454647"]);
		expect(byName["VIA SAN_URG"][3]).toBe("yes");
		expect(byName["UNKNOWN"]).toEqual([2.35, 48.86, "UNKNOWN"]);
		// ERs first, so a same-coordinate collapse in the bake keeps the ER.
		expect(entries[entries.length - 1][2]).toBe("UNKNOWN");
	});
});

describe("us adapter parsing", () => {
	it("parseCms drops explicit no-ER rows, maps Yes → yes, blank → null", () => {
		const csv = [
			'"Facility ID","Facility Name","Address","City/Town","State","ZIP Code","County/Parish","Telephone Number","Emergency Services"',
			'"010001","SOUTHEAST HEALTH","1108 ROSS CLARK CIRCLE","DOTHAN","AL","36301","HOUSTON","(334) 793-8701","Yes"',
			'"010002","NO ER PLACE","1 MAIN ST","MOBILE","AL","36601","MOBILE","(334) 555-0000","No"',
			'"010003","MYSTERY MED","2 OAK AVE","SELMA","AL","36701","DALLAS","",""',
		].join("\n");
		const rows = parseCms(csv);
		expect(rows.map((r) => r.id)).toEqual(["010001", "010003"]);
		expect(rows[0].emergency).toBe("yes");
		expect(rows[0].phone).toBe("(334) 793-8701");
		expect(rows[1].emergency).toBeNull();
	});

	it("parseBatchGeocode maps matches to [lng, lat] and misses to null", () => {
		const text = [
			'"010001","1108 ROSS CLARK CIRCLE, DOTHAN, AL, 36301","Match","Exact","1108 ROSS CLARK CIR, DOTHAN, AL, 36301","-85.361740,31.215775","637462","L"',
			'"010002","1 MAIN ST, NOWHERE, AL, 00000","No_Match"',
			'"010003","2 OAK AVE, SELMA, AL, 36701","Tie"',
		].join("\n");
		const got = parseBatchGeocode(text);
		expect(got.get("010001")).toEqual([-85.36174, 31.215775]);
		expect(got.get("010002")).toBeNull();
		expect(got.get("010003")).toBeNull();
	});
});
