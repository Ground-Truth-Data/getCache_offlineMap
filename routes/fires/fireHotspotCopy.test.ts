import { describe, expect, it } from "vitest";
import {
	areaLabel,
	bearingLabel,
	buildClusterCard,
	buildHotspotCard,
	CELL_KM,
	clusterAreaKm2,
	distanceLine,
	footprintLine,
	intensityLabel,
	intensityOf,
	kmApart,
	pingAgo,
	seenLabel,
} from "./fireHotspotCopy";
import { CELL_DEG } from "./masks/staticHeatSources";

const VANCOUVER: [number, number] = [-123.1, 49.28];
const KAMLOOPS: [number, number] = [-120.33, 50.67];
const NOW = Date.UTC(2026, 7, 8, 12, 0);

describe("intensity — the 'how big is this' number", () => {
	it("bands FRP from low to extreme", () => {
		expect(intensityOf(2)).toBe("low");
		expect(intensityOf(25)).toBe("moderate");
		expect(intensityOf(120)).toBe("high");
		expect(intensityOf(900)).toBe("extreme");
	});

	it("treats a garbage FRP as LOW, never as an emergency", () => {
		expect(intensityOf(Number.NaN)).toBe("low");
	});

	it("states the heat plainly, with no speculation about the cause", () => {
		expect(intensityLabel(3)).toBe("Low heat");
		expect(intensityLabel(900)).toBe("Very high heat");
		for (const frp of [1, 30, 120, 5000]) {
			expect(intensityLabel(frp).toLowerCase()).not.toContain("industrial");
		}
	});
});

describe("distance + bearing — 'is it coming for me?'", () => {
	it("measures a real distance", () => {
		const km = kmApart(VANCOUVER, KAMLOOPS);
		expect(km).toBeGreaterThan(230);
		expect(km).toBeLessThan(270);
	});

	it("names a compass direction, not degrees", () => {
		expect(bearingLabel(VANCOUVER, KAMLOOPS)).toBe("NE");
	});

	it("reads as a sentence a person can act on", () => {
		expect(distanceLine(KAMLOOPS, VANCOUVER)).toMatch(/^\d+ km NE of you$/);
	});

	it("never claims sub-km precision — the pixel is bigger than that", () => {
		const nearby: [number, number] = [-123.094, 49.284];
		expect(distanceLine(nearby, VANCOUVER)).toBe("Less than 1 km NE of you");
	});

	it("omits the line with no fix rather than inventing one", () => {
		expect(distanceLine(KAMLOOPS, null)).toBeNull();
	});
});

describe("seen — when the SATELLITE saw it", () => {
	it("counts minutes, then hours — and NEVER days", () => {
		expect(seenLabel(NOW - 30 * 60_000, NOW)).toBe("Seen 30 min ago");
		expect(seenLabel(NOW - 3 * 3_600_000, NOW)).toBe("Seen 3h ago");
		expect(seenLabel(NOW - 26 * 3_600_000, NOW)).toBe("Seen 26.0h ago");
		expect(seenLabel(NOW - 72 * 3_600_000, NOW)).toBe("Seen 72.0h ago");
	});

	it("never shows a negative age from clock skew", () => {
		expect(seenLabel(NOW + 60_000, NOW)).toBe("Seen 0 min ago");
	});
});

describe("footprint — a fact, not a caveat", () => {
	it("states the pixel size with no lecture attached", () => {
		expect(footprintLine(0.4)).toBe("Covers 400 m");
		expect(footprintLine(0.4)).not.toContain("not the whole");
	});

	it("falls back to VIIRS's nominal 375 m when the feed omits it", () => {
		expect(footprintLine(undefined)).toBe("Covers 375 m");
	});
});

describe("cluster area — one patch of ground counts ONCE", () => {
	const cellsEast = (n: number, px?: number) =>
		Array.from({ length: n }, (_, i) => ({
			coordinates: [-121 + i * 0.004, 50] as [number, number],
			...(px === undefined ? {} : { px }),
		}));

	it("sums genuinely DIFFERENT ground", () => {
		expect(clusterAreaKm2(cellsEast(4, 0.5))).toBeCloseTo(4 * 0.140625, 6);
	});

	it("counts a CELL of ground, not the pixel's footprint", () => {
		const wide = [{ coordinates: [-121, 50] as [number, number], px: 0.7 }];
		expect(clusterAreaKm2(wide)).toBeCloseTo(0.140625, 6);
	});

	it("counts the SAME ground once, however many times it was seen", () => {
		const same = Array.from({ length: 4 }, () => ({
			coordinates: [-121, 50] as [number, number],
			px: 0.5,
		}));
		expect(clusterAreaKm2(same)).toBeCloseTo(0.140625, 6);
	});

	it("collapses three satellites × eight passes over one patch", () => {
		const patch = [];
		for (let pass = 0; pass < 8; pass++) {
			for (let sat = 0; sat < 3; sat++) {
				for (let cell = 0; cell < 3; cell++) {
					patch.push({
						coordinates: [-121 + cell * 0.004, 50] as [number, number],
					});
				}
			}
		}
		expect(patch).toHaveLength(72);
		expect(clusterAreaKm2(patch)).toBeCloseTo(3 * 0.140625, 6);
	});

	it("reproduces the MEASURED cluster: 673 cells → ~95 km²", () => {
		// Live-FIRMS ground truth, each cell seen twice so the dedupe does real work.
		const cells = [];
		for (let i = 0; i < 673; i++) {
			const c = [-121 + (i % 30) * 0.004, 50 + Math.floor(i / 30) * 0.004] as [
				number,
				number,
			];
			cells.push({ coordinates: c }, { coordinates: c });
		}
		expect(cells).toHaveLength(1346);
		const km2 = clusterAreaKm2(cells);
		expect(km2).toBeCloseTo(673 * 0.140625, 1);
		expect(areaLabel(km2)).toBe("9,464 ha");
	});

	it("is NOT the area BETWEEN the dots", () => {
		const corners = [
			{ coordinates: [-121, 50] as [number, number] },
			{ coordinates: [-120.4, 50] as [number, number] },
			{ coordinates: [-121, 50.4] as [number, number] },
			{ coordinates: [-120.4, 50.4] as [number, number] },
		];
		expect(clusterAreaKm2(corners)).toBeCloseTo(4 * 0.140625, 6);
	});

	it("is independent of detection ORDER and of pixel size", () => {
		const at = (px: number) => ({
			coordinates: [-121, 50] as [number, number],
			px,
		});
		expect(clusterAreaKm2([at(0.375), at(0.75)])).toBeCloseTo(0.140625, 6);
		expect(clusterAreaKm2([at(0.75), at(0.375)])).toBeCloseTo(0.140625, 6);
	});

	it("the grid cell and the nominal pixel agree within 15%", () => {
		const fromDegrees = CELL_DEG * 111.32;
		expect(Math.abs(CELL_KM - fromDegrees) / fromDegrees).toBeLessThan(0.15);
	});

	it("uses the nominal pixel when px is missing", () => {
		expect(clusterAreaKm2([{ coordinates: [-121, 50] }])).toBeCloseTo(
			0.140625,
			5,
		);
	});

	it("keeps an ungriddable detection rather than dropping its area", () => {
		expect(clusterAreaKm2([{ px: 0.5 }])).toBeCloseTo(0.25, 6);
	});

	it("is zero for no detections", () => {
		expect(clusterAreaKm2([])).toBe(0);
	});
});

describe("areaLabel — hectares, the unit the job speaks", () => {
	it("reports hectares, never km²", () => {
		expect(areaLabel(0.140625)).toBe("14 ha");
		expect(areaLabel(2.08)).toBe("208 ha");
		expect(areaLabel(94.6)).toBe("9,460 ha");
	});

	it("shows one decimal under 10 ha and whole hectares above", () => {
		expect(areaLabel(0.042)).toBe("4.2 ha");
		expect(areaLabel(0.1)).toBe("10 ha");
	});

	it("falls to m² for a sliver, and NEVER prints zero", () => {
		expect(areaLabel(0.0005)).toBe("500 m²");
		expect(areaLabel(0.0000005)).toBe("1 m²");
	});

	it("matches the app's own formatArea rules", () => {
		// Mirrors featureMeasure.formatArea, which is not imported because it pulls in turf.
		const formatArea = (sqMetres: number): string => {
			const ha = sqMetres / 10000;
			if (ha < 0.1) return `${Math.round(sqMetres).toLocaleString()} m²`;
			if (ha < 10) return `${ha.toFixed(1)} ha`;
			return `${Math.round(ha).toLocaleString()} ha`;
		};
		for (const km2 of [0.0000005, 0.042, 0.1, 0.140625, 2.08, 94.6, 223.28]) {
			expect(areaLabel(km2)).toBe(formatArea(km2 * 1_000_000));
		}
	});
});

const val = (
	c: { rows: readonly { label: string; value: string }[] },
	label: string,
) => c.rows.find((r) => r.label === label)?.value;
const labels = (c: { rows: readonly { label: string }[] }) =>
	c.rows.map((r) => r.label);

describe("buildHotspotCard — labelled rows, not sentences", () => {
	const card = buildHotspotCard(
		{ coordinates: KAMLOOPS, t: NOW - 21 * 3_600_000, frp: 33, px: 0.375 },
		VANCOUVER,
		NOW,
		"46 km W of Merritt · 100 km NNE of Chilliwack",
	);

	it("is titled 'Fire detected'", () => {
		expect(card.title).toBe("Fire detected");
	});

	it("leads with Intensity as 'N of 5' and exposes the level for a meter", () => {
		expect(card.rows[0].label).toBe("Intensity");
		expect(card.rows[0].value).toMatch(/^[1-5] of 5$/);
		expect(card.rows[0].level).toBeGreaterThanOrEqual(1);
		expect(card.rows[0].level).toBeLessThanOrEqual(5);
	});

	it("orders the rows most-urgent first", () => {
		expect(labels(card)).toEqual([
			"Intensity",
			"Status",
			"Size",
			"First detected",
			"Nearest",
			"From you",
		]);
	});

	it("does not repeat the label inside the value", () => {
		expect(val(card, "First detected")).toBe("21.0h ago");
		expect(val(card, "From you")).toMatch(/^\d+ km NE$/);
		expect(val(card, "First detected")).not.toContain("Seen");
		expect(val(card, "From you")).not.toContain("of you");
	});

	it("carries the place reference verbatim", () => {
		expect(val(card, "Nearest")).toBe(
			"46 km W of Merritt · 100 km NNE of Chilliwack",
		);
	});

	it("OMITS rows it cannot fill, rather than faking them", () => {
		const bare = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: NOW, frp: 1 },
			null,
			NOW,
		);
		expect(labels(bare)).not.toContain("From you");
		expect(labels(bare)).not.toContain("Nearest");
		expect(labels(bare)).toEqual([
			"Intensity",
			"Status",
			"Size",
			"First detected",
		]);
	});

	it("carries no units to decode, no disclaimer, no agency link", () => {
		const all = card.rows.map((r) => `${r.label} ${r.value}`).join(" ");
		expect(all).not.toContain("MW");
		expect(all.toLowerCase()).not.toContain("confidence");
		expect(all.toLowerCase()).not.toContain("not a confirmed");
		expect(card).not.toHaveProperty("agency");
	});

	it("a single detection claims no trend — it has one pass by definition", () => {
		expect(val(card, "Status")).toBe("Newly spotted");
	});
});

describe("buildClusterCard — same shape, plus the spot count", () => {
	const many = Array.from({ length: 20 }, (_, i) => ({
		coordinates: [-120.3 + i * 0.01, 50.6] as [number, number],
		t: NOW - 6 * 3_600_000,
		frp: 5,
		px: 0.375,
	}));
	const withOneBig = [
		...many,
		{
			coordinates: [-120.1, 50.6] as [number, number],
			t: NOW - 2 * 3_600_000,
			frp: 400,
			px: 0.375,
		},
	];
	const card = buildClusterCard(withOneBig, KAMLOOPS, VANCOUVER, NOW);

	it("looks like a single detection's card — the reader sees ONE fire", () => {
		expect(card.title).toBe("Fire detected");
		expect(labels(card).slice(0, 3)).toEqual(["Intensity", "Status", "Size"]);
	});

	it("adds a 'Hot spots' row right after Size, where it gives area meaning", () => {
		expect(labels(card)).toEqual([
			"Intensity",
			"Status",
			"Size",
			"Hot spots",
			"First detected",
			"From you",
		]);
		expect(val(card, "Hot spots")).toBe("21 detected");
	});

	it("uses the PEAK heat, never a sum — 21 small fires are not an inferno", () => {
		expect(val(card, "Intensity")).toBe("4 of 5");
	});

	it("a cluster of only mild fires stays mild", () => {
		const mild = buildClusterCard(many, KAMLOOPS, VANCOUVER, NOW);
		expect(val(mild, "Intensity")).toBe("2 of 5");
	});

	it("reports the EARLIEST sighting — 'how long has this been burning?'", () => {
		expect(val(card, "First detected")).toBe("6h ago");
	});

	it("reports a short status, not a sentence", () => {
		const rising = [
			{ coordinates: KAMLOOPS, t: NOW - 18 * 3_600_000, frp: 20, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW - 12 * 3_600_000, frp: 20, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW - 6 * 3_600_000, frp: 300, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW, frp: 300, px: 0.375 },
		];
		const c = buildClusterCard(rising, KAMLOOPS, VANCOUVER, NOW);
		expect(val(c, "Status")).toBe("Growing");
		expect(val(c, "Status")).not.toContain("last pass");
	});

	it("says 'Dying down' when the heat is falling", () => {
		const fading = [
			{ coordinates: KAMLOOPS, t: NOW - 18 * 3_600_000, frp: 300, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW - 12 * 3_600_000, frp: 280, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW - 6 * 3_600_000, frp: 30, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW, frp: 20, px: 0.375 },
		];
		expect(
			val(buildClusterCard(fading, KAMLOOPS, VANCOUVER, NOW), "Status"),
		).toBe("Dying down");
	});

	it("handles a single-member cluster", () => {
		const one = buildClusterCard([many[0]], KAMLOOPS, VANCOUVER, NOW);
		expect(val(one, "Hot spots")).toBe("1 detected");
	});

	it("never asks 'hottest WHAT?'", () => {
		const all = card.rows
			.map((r) => `${r.label} ${r.value}`)
			.join(" ")
			.toLowerCase();
		expect(all).not.toContain("hottest");
		expect(all).not.toContain("cluster");
		expect(all).not.toContain("peak");
	});
});

describe("the time row — one clock, in the satellite's own verb", () => {
	const hot = {
		coordinates: KAMLOOPS,
		t: NOW - 9 * 3_600_000,
		frp: 40,
		px: 0.375,
	};
	const val = (
		c: { rows: readonly { label: string; value: string }[] },
		l: string,
	) => c.rows.find((r) => r.label === l)?.value;

	it("says 'First detected', not 'Last seen'", () => {
		const card = buildHotspotCard(hot, VANCOUVER, NOW);
		expect(val(card, "First detected")).toBe("9h ago");
		expect(card.rows.some((r) => r.label === "Last seen")).toBe(false);
	});

	it("carries NO second clock — no download-age row of any name", () => {
		const card = buildHotspotCard(hot, VANCOUVER, NOW);
		const labels = card.rows.map((r) => r.label);
		for (const banned of [
			"Checked",
			"Updated",
			"Fetched",
			"Downloaded",
			"As of",
		]) {
			expect(labels).not.toContain(banned);
		}
	});

	it("holds for the CLUSTER card too — both cards or neither", () => {
		const many = [
			hot,
			{ coordinates: KAMLOOPS, t: NOW - 3 * 3_600_000, frp: 90, px: 0.375 },
		];
		const card = buildClusterCard(many, KAMLOOPS, VANCOUVER, NOW);
		expect(val(card, "First detected")).toBe("9h ago");
		expect(card.rows.some((r) => r.label === "Checked")).toBe(false);
		expect(card.rows.some((r) => r.label === "Last detected")).toBe(false);
	});

	it("never shows two time rows at once", () => {
		const card = buildClusterCard([hot], KAMLOOPS, VANCOUVER, NOW);
		const ageRows = card.rows.filter((r) => /ago|Just now/.test(r.value));
		expect(ageRows).toHaveLength(1);
	});
});

describe("age is reported in HOURS, never rounded to days", () => {
	const NOW2 = Date.UTC(2026, 7, 9, 12, 0);
	const hAgo = (h: number) => NOW2 - h * 3_600_000;

	it("never emits the word 'day'", () => {
		for (const h of [23, 24, 25, 28, 36, 37, 47, 72]) {
			expect(seenLabel(hAgo(h), NOW2)).not.toMatch(/day/);
		}
	});

	it("keeps the exact hour past the 24 h line", () => {
		expect(seenLabel(hAgo(23), NOW2)).toBe("Seen 23.0h ago");
		expect(seenLabel(hAgo(28), NOW2)).toBe("Seen 28.0h ago");
		expect(seenLabel(hAgo(36), NOW2)).toBe("Seen 36.0h ago");
	});

	it("still uses minutes under an hour — the fresh end keeps its resolution", () => {
		expect(seenLabel(NOW2 - 42 * 60_000, NOW2)).toBe("Seen 42 min ago");
	});

	it("the card row carries it through", () => {
		const card = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: hAgo(28), frp: 20, px: 0.375 },
			VANCOUVER,
			NOW2,
		);
		const v = card.rows.find((r) => r.label === "First detected")?.value;
		expect(v).toBe("28.0h ago");
	});
});

describe("First detected — when it started burning", () => {
	const NOW3 = Date.UTC(2026, 7, 9, 12, 0);
	const hAgo = (h: number) => NOW3 - h * 3_600_000;
	const val = (
		c: { rows: readonly { label: string; value: string }[] },
		l: string,
	) => c.rows.find((r) => r.label === l)?.value;

	it("shows BOTH ends for a cluster seen across passes", () => {
		const card = buildClusterCard(
			[
				{ coordinates: KAMLOOPS, t: hAgo(22.3), frp: 2.95, px: 0.375 },
				{ coordinates: KAMLOOPS, t: hAgo(8.4), frp: 0.24, px: 0.375 },
			],
			KAMLOOPS,
			VANCOUVER,
			NOW3,
		);
		expect(val(card, "First detected")).toBe("22.3h ago");
		expect(card.rows.some((r) => r.label === "Last detected")).toBe(false);
	});

	it("a lone detection still reports WHEN, under First detected", () => {
		const card = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: hAgo(11), frp: 20, px: 0.375 },
			VANCOUVER,
			NOW3,
		);
		expect(val(card, "First detected")).toBe("11.0h ago");
	});

	it("uses FRACTIONS past 10h — a measurement, not a shrug", () => {
		expect(seenLabel(hAgo(23.7), NOW3)).toBe("Seen 23.7h ago");
		expect(seenLabel(hAgo(35.4), NOW3)).toBe("Seen 35.4h ago");
	});

	it("stays whole under 10h — no false precision on fresh data", () => {
		expect(seenLabel(hAgo(3), NOW3)).toBe("Seen 3h ago");
	});
});

describe("Last checked — our ping, not NASA's sighting", () => {
	const NOW4 = Date.UTC(2026, 7, 9, 12, 0);
	const mAgo = (m: number) => NOW4 - m * 60_000;
	const hAgo4 = (h: number) => NOW4 - h * 3_600_000;
	const val = (
		c: { rows: readonly { label: string; value: string }[] },
		l: string,
	) => c.rows.find((r) => r.label === l)?.value;

	it("keeps MINUTE resolution — the number people are actually curious about", () => {
		expect(pingAgo(mAgo(4), NOW4)).toBe("4 min ago");
		expect(pingAgo(mAgo(42), NOW4)).toBe("42 min ago");
	});

	it("says 'Just now' under a minute, never '0 min ago'", () => {
		expect(pingAgo(NOW4, NOW4)).toBe("Just now");
	});

	it("goes fractional past 10h — for someone who has been offline", () => {
		expect(pingAgo(hAgo4(23.7), NOW4)).toBe("23.7h ago");
	});

	it("appears BELOW the detections, as its own fact", () => {
		const card = buildClusterCard(
			[
				{ coordinates: KAMLOOPS, t: hAgo4(22.3), frp: 3, px: 0.375 },
				{ coordinates: KAMLOOPS, t: hAgo4(8.4), frp: 0.2, px: 0.375 },
			],
			KAMLOOPS,
			VANCOUVER,
			NOW4,
			null,
			false,
			mAgo(4),
		);
		const labels = card.rows.map((r) => r.label);
		expect(labels).toContain("Last checked");
		expect(labels.indexOf("Last checked")).toBeGreaterThan(
			labels.indexOf("First detected"),
		);
		expect(val(card, "Last checked")).toBe("4 min ago");
	});

	it("is DISTINCT from the detection rows — three facts, three verbs", () => {
		const card = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: hAgo4(23), frp: 20, px: 0.375 },
			VANCOUVER,
			NOW4,
			null,
			false,
			mAgo(5),
		);
		expect(val(card, "First detected")).toBe("23.0h ago");
		expect(val(card, "Last checked")).toBe("5 min ago");
	});

	it("is OMITTED, never faked, when unknown", () => {
		const card = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: hAgo4(3), frp: 20, px: 0.375 },
			VANCOUVER,
			NOW4,
		);
		expect(card.rows.some((r) => r.label === "Last checked")).toBe(false);
	});
});
