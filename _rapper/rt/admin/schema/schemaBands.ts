// What a schema heat map paints: each column's share of rows that carry a
// value. Shared by Foundr's Postgres map and Get Cache's SQLite map; each
// caller counts its own `filled`.

export type ColumnFill = {
	column: string;
	filled: number;
};

export type TableFill = {
	slug: string;
	model: string;
	rows: number;
	rowsAllSites: number;
	scoped: boolean;
	scopable: boolean;
	columns: ColumnFill[];
	error: string | null;
};

export type SchemaLink = {
	from: string;
	field: string;
	to: string;
	ref: string;
};

export type Expectation = "key" | "normal";

export const keyAttributeId = (table: string, column: string) => `${table}.${column}`;

/** A switched-off key drops to `normal`: "stop shouting" isn't "this hole is fine". */
export function expectationOf(
	table: string,
	column: string,
	activeKeys: ReadonlySet<string>,
): Expectation {
	return activeKeys.has(keyAttributeId(table, column)) ? "key" : "normal";
}

export type Health = {
	/** An empty table's columns are 0, like any other empty column. */
	fill: number;
	expectation: Expectation;
	band: Band;
};

/** Never depends on the table; the whole-table finding is the card's border (`tableEmpty`). */
export type Band = "empty-key" | "partial-key" | "empty" | "partial" | "full";

/** 0.99, not 1.0: rounding 99.4% up would hide 400 missing values on a 40,000-row table. */
const PARTIAL = 0.99;

export function healthOf(fill: number, expectation: Expectation): Health {
	const key = expectation === "key";
	let band: Band;
	if (fill === 0) band = key ? "empty-key" : "empty";
	else if (fill < PARTIAL) band = key ? "partial-key" : "partial";
	else band = "full";

	return { fill, expectation, band };
}

/** A border, not a tint: the rows already carry their own colour. */
export function tableEmpty(rows: number): boolean {
	return rows === 0;
}

export const BAND_LABEL: Record<Band, string> = {
	"empty-key": "missing — should be filled",
	"partial-key": "patchy — should be filled",
	empty: "nothing in it",
	partial: "some of it filled",
	full: "filled",
};
