/**
 * LAST-RESORT guess at "when was this row last touched", for a browser handed
 * an arbitrary table with no page to ask. NOT a rule any page should rely on
 * — `/app/sqlite` is the only caller with a genuine excuse. ORDER IS THE WHOLE
 * DESIGN: edit time beats creation time, and both beat a lifecycle stamp like
 * `retiredAt`, which is null for every live row and would sort them to the bottom.
 */
const BY_PREFERENCE = [
	"lastTouched",
	"updatedAt",
	"editedAt",
	"loggedAt",
	"tallyAt",
	"sentAt",
	"whenMs",
	"createdAt",
] as const;

/** The best recency column this table has, or "" when it has none. */
export function recencyColumn(columns: readonly string[]): string {
	const have = new Set(columns);
	for (const c of BY_PREFERENCE) if (have.has(c)) return c;
	return "";
}
