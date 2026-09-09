import { describe, expect, it } from "vitest";
import {
	contactsToLines,
	csvToRecordsJson,
	linesToContactsJson,
	recordsToCsv,
} from "./shareWire";

describe("shareWire — featureData ⇄ CSV", () => {
	it("unions columns in first-seen order and round-trips numbers", () => {
		const json =
			'[{"species":"pine","boxes":3,"seedzone":"NW 887"},{"species":"spruce","boxes":7,"specs":"min= 1.7, duff= no"}]';
		const csv = recordsToCsv(json);
		expect(csv).toBe(
			'species,boxes,seedzone,specs\npine,3,NW 887,\nspruce,7,,"min= 1.7, duff= no"',
		);
		expect(JSON.parse(csvToRecordsJson(csv) as string)).toEqual(
			JSON.parse(json),
		);
	});

	it("quotes commas, quotes and newlines and reads them back", () => {
		const json = '[{"note":"say \\"hi\\", then\\nleave","n":"0123"}]';
		const csv = recordsToCsv(json);
		expect(csv).toBe('note,n\n"say ""hi"", then\nleave",0123');
		expect(JSON.parse(csvToRecordsJson(csv) as string)).toEqual(
			JSON.parse(json),
		);
	});

	it("renders nothing for non-record JSON and null for a header-only CSV", () => {
		expect(recordsToCsv("not json")).toBe("");
		expect(recordsToCsv('"just a string"')).toBe("");
		expect(recordsToCsv("[]")).toBe("");
		expect(csvToRecordsJson("a,b")).toBeNull();
		expect(csvToRecordsJson("")).toBeNull();
	});

	it("wraps a single record object as one row", () => {
		expect(recordsToCsv('{"a":1}')).toBe("a\n1");
	});
});

describe("shareWire — contacts ⇄ lines", () => {
	it("one person per line, id only when known", () => {
		const json = '[{"id":"","name":"GreenDestiny"},{"id":"u-1","name":"Pete"}]';
		const lines = contactsToLines(json);
		expect(lines).toBe("GreenDestiny\nPete · u-1");
		expect(linesToContactsJson(lines)).toBe(json);
	});

	it("survives malformed input", () => {
		expect(contactsToLines("nope")).toBe("");
		expect(contactsToLines("[null, 3, {}]")).toBe("");
		expect(linesToContactsJson("  \n ")).toBeNull();
	});
});
