// ⚠️⚠️ DO NOT DELETE — shelved by Chris 5 Nov 2026. Pin photo discs and circles: a cool asset we will use again. Disconnected, not dead.
// ⚠️⚠️ Nothing imports this file. It is excluded from tests, type checks and builds. Read README.md beside it.

// The open rule: the map checks where the planter is only when it opens, and earns an area's blob on the second
// occasion there (≥ 4 h apart or another day), at once on a first open or after two weeks away.
import { describe, expect, it } from "vitest";
import { AREA_GAP_MS, areaOf, LONG_ABSENCE_MS, type OpenLog, planOpen } from "./areaOpens";

const LAKE: [number, number] = [-76.2, 45.04];
const TOWN: [number, number] = [-75.7, 45.42];
const HOUR = 3_600_000;
// Local noon, so ±a few hours stays on the same calendar day.
const NOON = new Date(2026, 10, 1, 12).getTime();
const wifi = { covered: false, wifi: true };
const recent = (at = NOON - HOUR): OpenLog => ({ last: at, areas: {} });

describe("planOpen", () => {
	it("downloads at once and zooms in on the first open ever", () => {
		const p = planOpen({ areas: {} }, NOON, LAKE, wifi);
		expect(p).toMatchObject({ download: "now", zoom: true });
	});

	it("downloads at once and zooms in after two weeks away, even on cellular", () => {
		const p = planOpen(recent(NOON - LONG_ABSENCE_MS), NOON, LAKE, { covered: false, wifi: false });
		expect(p).toMatchObject({ download: "now", zoom: true });
	});

	it("does nothing on one open in an area", () => {
		expect(planOpen(recent(), NOON, LAKE, wifi)).toMatchObject({ download: "no", zoom: false });
	});

	it("downloads on the second open in the same area at least four hours later", () => {
		const first = planOpen(recent(), NOON - AREA_GAP_MS, LAKE, wifi);
		expect(first.download).toBe("no");
		expect(planOpen(first.log, NOON, LAKE, wifi)).toMatchObject({ download: "now", zoom: false });
	});

	it("waits when the second open is the same day and under four hours on", () => {
		const first = planOpen(recent(NOON - 2 * HOUR), NOON - HOUR, LAKE, wifi);
		expect(planOpen(first.log, NOON, LAKE, wifi).download).toBe("no");
	});

	it("downloads when the second open is on another calendar day, however soon", () => {
		const lateNight = new Date(2026, 10, 1, 23, 30).getTime();
		const first = planOpen(recent(lateNight - HOUR), lateNight, LAKE, wifi);
		expect(planOpen(first.log, lateNight + HOUR, LAKE, wifi).download).toBe("now");
	});

	it("counts the occasion from its first open, so opens an hour apart all day still add up", () => {
		let log = recent(NOON - 6 * HOUR);
		for (let h = -5; h < 0; h++) log = planOpen(log, NOON + h * HOUR, LAKE, wifi).log;
		expect(planOpen(log, NOON, LAKE, wifi).download).toBe("now");
	});

	it("never counts another area's open", () => {
		const first = planOpen(recent(), NOON - AREA_GAP_MS, TOWN, wifi);
		expect(planOpen(first.log, NOON, LAKE, wifi).download).toBe("no");
	});

	it("skips a spot a blob already covers", () => {
		const first = planOpen(recent(), NOON - AREA_GAP_MS, LAKE, wifi);
		expect(planOpen(first.log, NOON, LAKE, { covered: true, wifi: true }).download).toBe("no");
		expect(planOpen({ areas: {} }, NOON, LAKE, { covered: true, wifi: true })).toMatchObject({ download: "no", zoom: true });
	});

	it("asks first on cellular", () => {
		const first = planOpen(recent(), NOON - AREA_GAP_MS, LAKE, wifi);
		expect(planOpen(first.log, NOON, LAKE, { covered: false, wifi: false }).download).toBe("ask");
	});

	it("still notes the open with no spot, so a later fix is not a first open", () => {
		const p = planOpen({ areas: {} }, NOON, null, wifi);
		expect(p).toMatchObject({ download: "no", zoom: true });
		expect(planOpen(p.log, NOON + HOUR, LAKE, wifi)).toMatchObject({ download: "no", zoom: false });
	});

	it("keeps only the most recent areas", () => {
		let log: OpenLog = recent();
		for (let i = 0; i < 100; i++) log = planOpen(log, NOON + i, [-120 + i * 0.5, 50], wifi).log;
		expect(Object.keys(log.areas).length).toBeLessThanOrEqual(64);
		expect(log.areas[areaOf(-120 + 99 * 0.5, 50)]).toBe(NOON + 99);
	});
});
