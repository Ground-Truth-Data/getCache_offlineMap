import { describe, expect, it } from "vitest";
import { ADMIN_PARENTS, FOUNDR_TOOL } from "./adminRoutes";

// Findable is not the same as declared: the schema tool was registered
// correctly and still invisible, marked `scopedToSite` — a pill after the
// SITE rule, dimmed until a project is picked, off the edge of the window.
// These assert the two things that decide whether a person finds it: which
// GROUP it lands in, and where in that group it sits.
describe("the schema pill", () => {
	const foundr = ADMIN_PARENTS.find((p) => p.key === "foundr");
	const tools = foundr?.tools ?? [];
	const schema = tools.find((t) => t.key === "schema");

	it("is declared on the Foundr parent", () => {
		expect(schema).toBeDefined();
		expect(schema?.href).toBe(`${FOUNDR_TOOL}/schema`);
	});

	// The map draws every project when none is picked, so a scoped pill would hide its broadest reading behind a filter.
	it("rides in the corpus group, not behind the SITE rule", () => {
		expect(schema?.scopedToSite).toBeFalsy();
	});

	// The Foundr tool row already overflows its window; appended to the end is a pill nobody scrolls to.
	it("leads the TOOLS run", () => {
		const corpus = tools.filter((t) => !t.scopedToSite && !t.ownRow);
		expect(corpus[0]?.key).toBe("schema");
	});
});
