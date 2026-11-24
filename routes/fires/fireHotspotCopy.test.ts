import { beforeEach, describe, expect, it } from "vitest";
import { areaUnit, distance } from "$gc/units.svelte";
import {
	areaLabel,
	bearingLabel,
	buildClusterCard,
	buildHotspotCard,
	CELL_KM,
	clusterAreaKm2,
	distanceLine,
	kmApart,
	pingAgo,
	seenLabel,
} from "./fireHotspotCopy";
import { CELL_DEG } from "./masks/staticHeatSources";
import { m } from "$parent/src/lib/paraglide/messages";

const ROW = {
	intensity: m.ofmap_shared_fire_row_intensity(),
	status: m.ofmap_shared_fire_row_status(),
	size: m.ofmap_shared_fire_row_size(),
	hotSpots: m.ofmap_shared_fire_row_hot_spots(),
	firstDetected: m.ofmap_shared_fire_row_first_detected(),
	nearest: m.ofmap_shared_fire_row_nearest(),
	fromYou: m.ofmap_shared_fire_row_from_you(),
	lastChecked: m.ofmap_shared_fire_row_last_checked(),
};
const hrs = (hours: string) => m.ofmap_shared_fire_ago_hours({ hours });
const mins = (n: number) => m.ofmap_shared_fire_ago_min({ mins: n });
const seen = (ago: string) => m.ofmap_shared_fire_seen({ ago });

const VANCOUVER: [number, number] = [-123.1, 49.28];
const KAMLOOPS: [number, number] = [-120.33, 50.67];
const NOW = Date.UTC(2026, 7, 8, 12, 0);

// The runner's en-US would otherwise start every test in imperial.
beforeEach(() => {
	distance.value = "metric";
	areaUnit.value = "ha";
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
		expect(distanceLine(KAMLOOPS, VANCOUVER)).toMatch(/\d+ km NE/);
	});

	it("never claims sub-km precision — the pixel is bigger than that", () => {
		const nearby: [number, number] = [-123.094, 49.284];
		expect(distanceLine(nearby, VANCOUVER)).toBe(m.ofmap_shared_fire_of_you({ distance: m.ofmap_shared_fire_distance_under({ unit: "km", dir: "NE" }) }));
	});

	it("omits the line with no fix rather than inventing one", () => {
		expect(distanceLine(KAMLOOPS, null)).toBeNull();
	});
});

describe("seen — when the SATELLITE saw it", () => {
	it("counts minutes, then hours — and NEVER days", () => {
		expect(seenLabel(NOW - 30 * 60_000, NOW)).toBe(seen(mins(30)));
		expect(seenLabel(NOW - 3 * 3_600_000, NOW)).toBe(seen(hrs("3")));
		expect(seenLabel(NOW - 26 * 3_600_000, NOW)).toBe(seen(hrs("26.0")));
		expect(seenLabel(NOW - 72 * 3_600_000, NOW)).toBe(seen(hrs("72.0")));
	});

	it("never shows a negative age from clock skew", () => {
		expect(seenLabel(NOW + 60_000, NOW)).toBe(seen(mins(0)));
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

	it("speaks acres and miles when the phone is set to acres and imperial", () => {
		areaUnit.value = "ac";
		distance.value = "imperial";
		expect(areaLabel(0.042)).toBe("10 ac");
		expect(areaLabel(2.08)).toBe("514 ac");
		expect(distanceLine(KAMLOOPS, VANCOUVER)).toMatch(/\d+ mi NE/);
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
		expect(card.title).toBe(m.ofmap_shared_fire_title());
	});

	it("leads with Intensity as 'N of 5' and exposes the level for a meter", () => {
		expect(card.rows[0].label).toBe(ROW.intensity);
		expect(card.rows[0].value).toBe(m.ofmap_shared_fire_intensity_value({ level: card.rows[0].level }));
		expect(card.rows[0].level).toBeGreaterThanOrEqual(1);
		expect(card.rows[0].level).toBeLessThanOrEqual(5);
	});

	it("orders the rows most-urgent first", () => {
		expect(labels(card)).toEqual([
			ROW.intensity,
			ROW.status,
			ROW.size,
			ROW.firstDetected,
			ROW.nearest,
			ROW.fromYou,
		]);
	});

	it("does not repeat the label inside the value", () => {
		expect(val(card, ROW.firstDetected)).toBe(hrs("21.0"));
		expect(val(card, ROW.fromYou)).toMatch(/^\d+ km NE$/);
	});

	it("carries the place reference verbatim", () => {
		expect(val(card, ROW.nearest)).toBe(
			"46 km W of Merritt · 100 km NNE of Chilliwack",
		);
	});

	it("OMITS rows it cannot fill, rather than faking them", () => {
		const bare = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: NOW, frp: 1 },
			null,
			NOW,
		);
		expect(labels(bare)).not.toContain(ROW.fromYou);
		expect(labels(bare)).not.toContain(ROW.nearest);
		expect(labels(bare)).toEqual([
			ROW.intensity,
			ROW.status,
			ROW.size,
			ROW.firstDetected,
		]);
	});

	it("carries no agency link", () => {
		expect(card).not.toHaveProperty("agency");
	});

	it("a single detection claims no trend — it has one pass by definition", () => {
		expect(val(card, ROW.status)).toBe(m.ofmap_shared_fire_trend_new());
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
		expect(card.title).toBe(m.ofmap_shared_fire_title());
		expect(labels(card).slice(0, 3)).toEqual([ROW.intensity, ROW.status, ROW.size]);
	});

	it("adds a 'Hot spots' row right after Size, where it gives area meaning", () => {
		expect(labels(card)).toEqual([
			ROW.intensity,
			ROW.status,
			ROW.size,
			ROW.hotSpots,
			ROW.firstDetected,
			ROW.fromYou,
		]);
		expect(val(card, ROW.hotSpots)).toContain("21");
	});

	it("uses the PEAK heat, never a sum — 21 small fires are not an inferno", () => {
		expect(val(card, ROW.intensity)).toBe(m.ofmap_shared_fire_intensity_value({ level: 4 }));
	});

	it("a cluster of only mild fires stays mild", () => {
		const mild = buildClusterCard(many, KAMLOOPS, VANCOUVER, NOW);
		expect(val(mild, ROW.intensity)).toBe(m.ofmap_shared_fire_intensity_value({ level: 2 }));
	});

	it("reports the EARLIEST sighting — 'how long has this been burning?'", () => {
		expect(val(card, ROW.firstDetected)).toBe(hrs("6"));
	});

	it("reports a short status, not a sentence", () => {
		const rising = [
			{ coordinates: KAMLOOPS, t: NOW - 18 * 3_600_000, frp: 20, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW - 12 * 3_600_000, frp: 20, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW - 6 * 3_600_000, frp: 300, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW, frp: 300, px: 0.375 },
		];
		const c = buildClusterCard(rising, KAMLOOPS, VANCOUVER, NOW);
		expect(val(c, ROW.status)).toBe(m.ofmap_shared_fire_trend_growing());
		expect(val(c, ROW.status)).not.toContain("last pass");
	});

	it("says 'Dying down' when the heat is falling", () => {
		const fading = [
			{ coordinates: KAMLOOPS, t: NOW - 18 * 3_600_000, frp: 300, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW - 12 * 3_600_000, frp: 280, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW - 6 * 3_600_000, frp: 30, px: 0.375 },
			{ coordinates: KAMLOOPS, t: NOW, frp: 20, px: 0.375 },
		];
		expect(
			val(buildClusterCard(fading, KAMLOOPS, VANCOUVER, NOW), ROW.status),
		).toBe(m.ofmap_shared_fire_trend_quieter());
	});

	it("handles a single-member cluster", () => {
		const one = buildClusterCard([many[0]], KAMLOOPS, VANCOUVER, NOW);
		expect(val(one, ROW.hotSpots)).toContain("1");
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

	it("dates a lone detection under First detected", () => {
		const card = buildHotspotCard(hot, VANCOUVER, NOW);
		expect(val(card, ROW.firstDetected)).toBe(hrs("9"));
	});

	it("holds for the CLUSTER card too — both cards or neither", () => {
		const many = [
			hot,
			{ coordinates: KAMLOOPS, t: NOW - 3 * 3_600_000, frp: 90, px: 0.375 },
		];
		const card = buildClusterCard(many, KAMLOOPS, VANCOUVER, NOW);
		expect(val(card, ROW.firstDetected)).toBe(hrs("9"));
	});

	it("never shows two time rows at once", () => {
		const card = buildClusterCard([hot], KAMLOOPS, VANCOUVER, NOW);
		const ageRows = card.rows.filter((r) => r.label === ROW.firstDetected || r.label === ROW.lastChecked);
		expect(ageRows).toHaveLength(1);
	});
});

describe("age is reported in HOURS, never rounded to days", () => {
	const NOW2 = Date.UTC(2026, 7, 9, 12, 0);
	const hAgo = (h: number) => NOW2 - h * 3_600_000;

	it("keeps the exact hour past the 24 h line", () => {
		expect(seenLabel(hAgo(23), NOW2)).toBe(seen(hrs("23.0")));
		expect(seenLabel(hAgo(28), NOW2)).toBe(seen(hrs("28.0")));
		expect(seenLabel(hAgo(36), NOW2)).toBe(seen(hrs("36.0")));
	});

	it("still uses minutes under an hour — the fresh end keeps its resolution", () => {
		expect(seenLabel(NOW2 - 42 * 60_000, NOW2)).toBe(seen(mins(42)));
	});

	it("the card row carries it through", () => {
		const card = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: hAgo(28), frp: 20, px: 0.375 },
			VANCOUVER,
			NOW2,
		);
		const v = card.rows.find((r) => r.label === ROW.firstDetected)?.value;
		expect(v).toBe(hrs("28.0"));
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
		expect(val(card, ROW.firstDetected)).toBe(hrs("22.3"));
	});

	it("a lone detection still reports WHEN, under First detected", () => {
		const card = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: hAgo(11), frp: 20, px: 0.375 },
			VANCOUVER,
			NOW3,
		);
		expect(val(card, ROW.firstDetected)).toBe(hrs("11.0"));
	});

	it("uses FRACTIONS past 10h — a measurement, not a shrug", () => {
		expect(seenLabel(hAgo(23.7), NOW3)).toBe(seen(hrs("23.7")));
		expect(seenLabel(hAgo(35.4), NOW3)).toBe(seen(hrs("35.4")));
	});

	it("stays whole under 10h — no false precision on fresh data", () => {
		expect(seenLabel(hAgo(3), NOW3)).toBe(seen(hrs("3")));
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
		expect(pingAgo(mAgo(4), NOW4)).toBe(mins(4));
		expect(pingAgo(mAgo(42), NOW4)).toBe(mins(42));
	});

	it("says 'Just now' under a minute, never '0 min ago'", () => {
		expect(pingAgo(NOW4, NOW4)).toBe(m.ofmap_shared_fire_just_now());
	});

	it("goes fractional past 10h — for someone who has been offline", () => {
		expect(pingAgo(hAgo4(23.7), NOW4)).toBe(hrs("23.7"));
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
		expect(labels).toContain(ROW.lastChecked);
		expect(labels.indexOf(ROW.lastChecked)).toBeGreaterThan(
			labels.indexOf(ROW.firstDetected),
		);
		expect(val(card, ROW.lastChecked)).toBe(mins(4));
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
		expect(val(card, ROW.firstDetected)).toBe(hrs("23.0"));
		expect(val(card, ROW.lastChecked)).toBe(mins(5));
	});

	it("is OMITTED, never faked, when unknown", () => {
		const card = buildHotspotCard(
			{ coordinates: KAMLOOPS, t: hAgo4(3), frp: 20, px: 0.375 },
			VANCOUVER,
			NOW4,
		);
		expect(card.rows.some((r) => r.label === ROW.lastChecked)).toBe(false);
	});
});
