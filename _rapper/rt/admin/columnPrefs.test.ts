import { afterEach, describe, expect, it, vi } from "vitest";
import {
	applyColumnOrder,
	DEFAULT_FIT,
	distinctChars,
	fitLabels,
	fitMode,
	fitWeights,
	hiddenFromParams,
	hiddenToParams,
	loadColumnPrefs,
	saveColumnPrefs,
	toggleColumn,
	visibleColumns,
} from "./columnPrefs";

const COLS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const except = (keep: string[]) => COLS.filter((c) => !keep.includes(c));

describe("visibleColumns", () => {
	it("shows everything when nothing is hidden", () => {
		expect(visibleColumns(COLS, [])).toEqual(COLS);
	});

	it("drops the hidden ones, keeping schema order", () => {
		expect(visibleColumns(COLS, ["c", "a"])).toEqual([
			"b",
			"d",
			"e",
			"f",
			"g",
			"h",
		]);
	});

	// The picker is reached from the header, so an empty header is a screen
	// with no way back to its own columns.
	it("never renders an empty table, however much is hidden", () => {
		expect(visibleColumns(COLS, COLS)).toEqual(["a"]);
	});

	it("ignores a hidden column the table no longer has", () => {
		expect(visibleColumns(["a", "b"], ["gone"])).toEqual(["a", "b"]);
	});
});

describe("hiddenFromParams", () => {
	it("hides nothing when the URL says nothing", () => {
		expect(hiddenFromParams(new URLSearchParams(), COLS)).toEqual([]);
	});

	it("reads the hidden set out of ?hide=", () => {
		expect(hiddenFromParams(new URLSearchParams("hide=c,e"), COLS)).toEqual([
			"c",
			"e",
		]);
	});

	it("tolerates spaces around the names", () => {
		expect(hiddenFromParams(new URLSearchParams("hide=c, e"), COLS)).toEqual([
			"c",
			"e",
		]);
	});

	// A saved link outlives the schema it was made against. A name that no
	// longer exists must not travel on through every link copied from this one.
	it("drops a name the table does not have", () => {
		expect(hiddenFromParams(new URLSearchParams("hide=c,ghost"), COLS)).toEqual(
			["c"],
		);
	});

	// THE REPORT MUST NOT ROT. This is the reason the param names what is OFF:
	// a column added to the schema after the link was saved is not in the
	// hidden list, so it simply appears.
	it("shows a column added since the link was saved", () => {
		const saved = new URLSearchParams("hide=c");
		const grown = [...COLS, "newColumn"];
		expect(visibleColumns(grown, hiddenFromParams(saved, grown))).toContain(
			"newColumn",
		);
	});
});

describe("hiddenToParams", () => {
	it("writes the hidden set when few are hidden", () => {
		const p = hiddenToParams(new URLSearchParams(), ["c", "e"], COLS);
		expect(p.get("hide")).toBe("c,e");
		expect(p.has("cols")).toBe(false);
	});

	// "Everything on" is spelled by absence, so the plain table URL stays plain.
	it("removes the param entirely when nothing is hidden", () => {
		const p = hiddenToParams(new URLSearchParams("hide=c"), [], COLS);
		expect(p.has("hide")).toBe(false);
		expect(p.has("cols")).toBe(false);
	});

	it("leaves the other params alone", () => {
		const p = hiddenToParams(
			new URLSearchParams("fcol=platformId&page=3"),
			["c"],
			COLS,
		);
		expect(p.get("fcol")).toBe("platformId");
		expect(p.get("page")).toBe("3");
	});

	it("round-trips through hiddenFromParams", () => {
		const hidden = ["b", "d", "h"];
		const p = hiddenToParams(new URLSearchParams(), hidden, COLS);
		expect(hiddenFromParams(p, COLS)).toEqual(hidden);
	});

	// A NARROW REPORT MUST NOT PRODUCE A HUGE URL. Naming the 27 columns you
	// did not pick to show 5 was a 538-character link — long enough that mail
	// and chat clients wrap and break it.
	it("flips to ?cols= when that is the shorter half", () => {
		const keep = ["a", "b"];
		const p = hiddenToParams(new URLSearchParams(), except(keep), COLS);
		expect(p.get("cols")).toBe("a,b");
		expect(p.has("hide")).toBe(false);
	});

	it("round-trips the narrow spelling too", () => {
		const keep = ["a", "b"];
		const p = hiddenToParams(new URLSearchParams(), except(keep), COLS);
		expect(visibleColumns(COLS, hiddenFromParams(p, COLS))).toEqual(keep);
	});

	// The two spellings differ ON PURPOSE, and only here: `?cols=` names a
	// closed set, so "the contact report" stays those fields rather than
	// growing whatever is added next.
	it("?cols= does NOT pick up a column added later", () => {
		const p = hiddenToParams(
			new URLSearchParams(),
			except(["a", "b"]),
			COLS,
		);
		const grown = [...COLS, "newColumn"];
		expect(visibleColumns(grown, hiddenFromParams(p, grown))).not.toContain(
			"newColumn",
		);
	});
});

describe("toggleColumn", () => {
	it("hides a shown column and shows a hidden one", () => {
		const off = toggleColumn([], "c");
		expect(off).toEqual(["c"]);
		expect(toggleColumn(off, "c")).toEqual([]);
	});
});

// The saved order is localStorage — written by an older build, by another
// table, or by a bug. A repeated name renders as two columns sharing one key,
// and a keyed {#each} does not degrade: it throws `each_key_duplicate` and the
// whole table blanks. Uniqueness is enforced HERE, where the list is rebuilt,
// because every caller passes this value straight to the render.
describe("applyColumnOrder — the saved order is untrusted input", () => {
	it("never returns the same column twice, whatever was saved", () => {
		expect(applyColumnOrder(["a", "b", "c"], ["a", "b", "a"])).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("de-dupes the defaults too", () => {
		expect(applyColumnOrder(["a", "a", "b"])).toEqual(["a", "b"]);
	});

	it("drops saved names the table no longer has", () => {
		expect(applyColumnOrder(["x", "y"], ["a", "b"])).toEqual(["x", "y"]);
	});

	it("keeps the saved order and slots a new column beside its neighbour", () => {
		expect(applyColumnOrder(["a", "b", "c"], ["c", "a"])).toEqual([
			"c",
			"a",
			"b",
		]);
	});
});

describe("fitMode", () => {
	it("defaults a table nobody has answered for to comfort", () => {
		expect(fitMode({})).toBe("comfort");
		expect(DEFAULT_FIT).toBe("comfort");
	});

	it("returns each of the three modes it was given", () => {
		expect(fitMode({ fit: "comfort" })).toBe("comfort");
		expect(fitMode({ fit: "fit" })).toBe("fit");
		expect(fitMode({ fit: "full" })).toBe("full");
	});

	// localStorage outlives the build that wrote it, so a mode this one no longer
	// has must read as "unanswered" rather than reach the width machinery.
	it("falls back when storage names a mode this build dropped", () => {
		expect(fitMode({ fit: "cosy" as never })).toBe("comfort");
		expect(fitMode({ fit: "" as never })).toBe("comfort");
	});

	it("reads the mode past the other prefs", () => {
		expect(fitMode({ order: ["b", "a"], widths: { a: 90 }, fit: "full" })).toBe(
			"full",
		);
	});
});

describe("the mode is remembered per table", () => {
	const store = new Map<string, string>();
	afterEach(() => {
		store.clear();
		vi.unstubAllGlobals();
	});
	const stub = () =>
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k),
		});

	it("survives a reload", () => {
		stub();
		saveColumnPrefs("OrganizationTable", { fit: "full" });
		expect(fitMode(loadColumnPrefs("OrganizationTable"))).toBe("full");
	});

	// Keyed by table name, so one table's answer is not every table's.
	it("does not leak to another table", () => {
		stub();
		saveColumnPrefs("OrganizationTable", { fit: "fit" });
		expect(fitMode(loadColumnPrefs("StakeholderTable"))).toBe("comfort");
	});

	it("is worth a stored key on its own, with no order or widths", () => {
		stub();
		saveColumnPrefs("ClaimTable", { fit: "comfort" });
		expect(loadColumnPrefs("ClaimTable")).toEqual({ fit: "comfort" });
	});

	// A stored value outlives the code that wrote it and any hand in devtools,
	// and a throw here takes the whole table down until storage is cleared.
	it("reads a stored value of the wrong shape as no prefs", () => {
		stub();
		store.set("rtAdminCols:A", "null");
		store.set("rtAdminCols:B", '{"order":5,"widths":{"a":"wide","b":90}}');
		store.set("rtAdminCols:C", '{"order":{},"widths":[3]}');
		expect(fitMode(loadColumnPrefs("A"))).toBe("comfort");
		expect(loadColumnPrefs("B")).toEqual({ widths: { b: 90 } });
		expect(() => applyColumnOrder(["a", "b"], loadColumnPrefs("C").order)).not.toThrow();
	});

	it("drops a save the browser refuses rather than throwing mid-drag", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {
				throw new DOMException("full", "QuotaExceededError");
			},
			removeItem: () => {},
		});
		expect(() => saveColumnPrefs("ClaimTable", { fit: "fit" })).not.toThrow();
	});

	it("keeps order and widths alongside it", () => {
		stub();
		saveColumnPrefs("ClaimTable", { order: ["b", "a"], widths: { a: 90 } });
		saveColumnPrefs("ClaimTable", {
			...loadColumnPrefs("ClaimTable"),
			fit: "fit",
		});
		expect(loadColumnPrefs("ClaimTable")).toEqual({
			order: ["b", "a"],
			widths: { a: 90 },
			fit: "fit",
		});
	});
});

// The eight columns that rendered eight identical `sc…` headers.
const SCORES = [
	"scoreRankOverall",
	"scorePointsAvailable",
	"scorePointsScored",
	"scoreOrgPreClaim",
	"scoreSumClaimed",
	"scoreOrgFinal",
	"scoreOrgFlag",
	"scoreRankByCategory",
];

describe("fitLabels", () => {
	it("collapses every word but the last to an initial", () => {
		expect(fitLabels(["organizationKey", "scoreRankOverall"])).toEqual([
			"oKey",
			"sROverall",
		]);
	});

	it("reads the same for snake_case as for camelCase", () => {
		expect(fitLabels(["stakeholder_category_desc"])).toEqual(["scDesc"]);
	});

	it("leaves a single word alone", () => {
		expect(fitLabels(["address", "website"])).toEqual(["address", "website"]);
	});

	it("puts the letters that differ within the first few characters", () => {
		// The point of the whole function: a shared stem cannot survive truncation.
		expect(fitLabels(SCORES).map((l) => l.slice(0, 3))).toEqual([
			"sRO",
			"sPA",
			"sPS",
			"sOP",
			"sSC",
			"sOF",
			"sOF",
			"sRB",
		]);
	});

	it("grows the initials rather than returning a duplicate", () => {
		// Both collapse to `pName` on one initial, so both take two.
		expect(fitLabels(["projectName", "platformName"])).toEqual([
			"prName",
			"plName",
		]);
	});

	it("never maps two columns onto one header", () => {
		const out = fitLabels([...SCORES, "scoreHistoryLog", "scoreLastUpdatedAt"]);
		expect(new Set(out).size).toBe(out.length);
	});
});

describe("distinctChars", () => {
	it("counts to where a label stops matching the others", () => {
		expect(distinctChars(["sOFinal", "sOFlag"])).toEqual([4, 4]);
	});

	it("asks for two characters even where one would be unique", () => {
		expect(distinctChars(["alpha", "beta"])).toEqual([2, 2]);
	});

	it("never asks for more than the label has", () => {
		expect(distinctChars(["a", "b"])).toEqual([1, 1]);
	});
});

describe("fitWeights", () => {
	const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);

	it("spends exactly one window", () => {
		expect(sum(fitWeights([3, 3, 9], [0, 4, 40], 112))).toBeCloseTo(1);
	});

	it("pays a column with nothing in it its floor and no more", () => {
		// Two identical floors, one with content: the empty one must come out
		// narrower, which is the whole defect this replaced.
		const [empty, held] = fitWeights([3, 3], [0, 9], 112);
		expect(empty).toBeLessThan(held);
	});

	it("divides the content share in proportion to the bids", () => {
		// Straight proportion, so holding the outliers back is the caller's job —
		// the component bids the square root of what a column holds.
		const [even] = fitWeights([3, 3], [2, 2], 112);
		const [lean, held] = fitWeights([3, 3], [1, 3], 112);
		expect(even).toBeCloseTo(0.5);
		expect(held - lean).toBeGreaterThan(0.4);
	});

	it("leaves the floors to split a window where nothing has content", () => {
		expect(fitWeights([1, 3], [0, 0], 112)).toEqual([0.25, 0.75]);
	});

	it("keeps a crowded table's floors ahead of its content", () => {
		// Floors already over-subscribing the window: content gets the tenth it is
		// guaranteed, not the difference.
		const floors = Array.from({ length: 34 }, () => 3);
		const weights = fitWeights(floors, floors.map((_, i) => (i === 0 ? 40 : 0)), 112);
		expect(weights[0]).toBeCloseTo((0.9 * 3) / 102 + 0.1, 5);
	});

	it("leaves an empty column its floor however little else is on the table", () => {
		// Content is capped at four fifths, so the one column holding everything
		// cannot squeeze its neighbour out of the window.
		const [thin, fat] = fitWeights([3, 3], [0, 400], 10_000);
		expect(thin).toBeCloseTo(0.1);
		expect(fat).toBeCloseTo(0.9);
	});
});
