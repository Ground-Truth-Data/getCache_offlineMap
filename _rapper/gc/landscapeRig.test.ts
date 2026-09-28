import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasBottomBar, hasTopBar, isLandscapeRoute } from "./rigOrientation";

const read = (rel: string) =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const rig = read("./PhoneRig.svelte");
const theme = read("./theme.css");

/** The .rig-landscape rules with comments stripped, or prose naming a property satisfies the pattern. */
const landscapeRule = () =>
	theme.slice(theme.indexOf(".rig-landscape")).replace(/\/\*[\s\S]*?\*\//g, "");

const landscapeFits = () =>
	[...landscapeRule().matchAll(/--fit:([^;]*);/g)].map((m) =>
		m[1].replace(/\s+/g, " ").trim(),
	);

/** Which phone axis each vertical (100cqh) term divides by. */
const landscapeHeadrooms = () =>
	[...landscapeRule().matchAll(/100cqh[^;]*?\/\s*var\((--phone-\w+)\)/g)].map(
		(m) => m[1],
	);

describe("the phone can be turned a quarter turn", () => {
	it("is opt-in, so every other page keeps the portrait rig", () => {
		expect(rig).toMatch(/landscape\s*=\s*false/);
	});

	it("turns the PHONE clockwise", () => {
		// Only the wrapper's own transform: the screen inside is turned the other way.
		const wrapper = theme.slice(
			theme.indexOf(".mobile-preview-backdrop.rig-landscape .mobile-preview-wrapper"),
		);
		const transform =
			wrapper.replace(/\/\*[\s\S]*?\*\//g, "").match(/transform:([^;]*);/)?.[1] ?? "";
		expect(transform).toMatch(/rotate\(90deg\)/);
		expect(transform).not.toMatch(/rotate\(-90deg\)/);
	});

	it("turns the SCREEN back, so the page inside stays upright", () => {
		expect(rig).toContain("mobile-preview-screen");
		const screen = theme.slice(theme.indexOf(".mobile-preview-screen {"));
		expect(screen).toMatch(/rotate\(-90deg\)/);
	});

	it("turns one box, not each child", () => {
		expect(theme).not.toMatch(/\.rig-landscape[^{]*\.mobile-preview-frame\s*>\s*\*/);
	});
});

describe("the fit rule follows the turn", () => {
	it("divides by the axis that is vertical ON SCREEN, not the taller one", () => {
		const headrooms = landscapeHeadrooms();
		expect(headrooms.length).toBeGreaterThan(0);
		for (const axis of headrooms) expect(axis).toBe("--phone-width");
	});

	it("spends no horizontal nudge, which turned there is no room for", () => {
		const rule = theme
			.slice(theme.indexOf(".rig-landscape"))
			.replace(/\/\*[\s\S]*?\*\//g, "");
		const transform = rule.match(/transform:([^;]*);/)?.[1] ?? "";
		expect(transform).toMatch(/rotate\(90deg\)/);
		expect(transform).not.toMatch(/--wrapper-nudge/);
	});

	it("grows to fill the stage rather than stopping at its drawing size", () => {
		for (const fit of landscapeFits()) expect(fit).not.toMatch(/min\(\s*1\s*,/);
	});

	it("asks about both axes, so whichever runs out first decides", () => {
		const rule = landscapeRule();
		expect(rule).toMatch(/--fit-h:[^;]*100cqh[^;]*--phone-width/);
		expect(rule).toMatch(/--fit-w:[^;]*100cqw[^;]*--phone-height/);
	});
});

describe("the hand-tuned geometry is not re-solved to make this fit", () => {
	it("leaves the settled phone and hand numbers alone", () => {
		expect(theme).toContain("--phone-width: 452px");
		expect(theme).toContain("--phone-height: 936px");
		expect(theme).toContain("--hand-width: 1484px");
		expect(theme).toContain("--hand-left: -673px");
		expect(theme).toContain("--hand-top: -51px");
	});
});

describe("which routes are turned", () => {
	it("turns the georef route, under either mounting", () => {
		expect(isLandscapeRoute("/app/georef")).toBe(true);
		expect(isLandscapeRoute("/georef")).toBe(true);
		expect(isLandscapeRoute("/app/georef/")).toBe(true);
	});

	it("drops both bars together, never one", () => {
		expect(hasTopBar("/app/georef")).toBe(false);
		expect(hasBottomBar("/app/georef")).toBe(false);
		expect(hasBottomBar("/georef")).toBe(false);
	});

	it("leaves the bars alone everywhere else", () => {
		for (const route of ["/app/map", "/app/offlinev10", "/"]) {
			expect(hasTopBar(route)).toBe(true);
			expect(hasBottomBar(route)).toBe(true);
		}
	});

	it("is asked by every mount that draws a bar", () => {
		const chrome = read("./HostChrome.svelte");
		const rt = read("../../ReTreever/src/routes/(getcache)/+layout@.svelte");
		for (const src of [chrome, rt]) expect(src).toMatch(/hasBottomBar\(/);
	});

	it("leaves every other route standing up", () => {
		for (const route of ["/app/map", "/app/offlinev10", "/", "/app/map/debug"])
			expect(isLandscapeRoute(route)).toBe(false);
	});

	// A ratio cannot promise pixels, so the test is on the shape, not the number.
	it("keeps the turned phone off the window edges by a fixed gutter", () => {
		const rule = landscapeRule();
		expect(rule).toMatch(/--stage-side:\s*\d+px/);
		expect(rule).toMatch(/--fit-w:[^;]*100cqw\s*-\s*var\(--stage-side\)/);
	});

	it("does not go back to reaching for the whole stage", () => {
		expect(landscapeRule()).not.toMatch(/--stage-reach:\s*1\s*;/);
	});

	it("is decided in one table, not once per mounting layout", () => {
		const mounts = [
			read("../../getCache_OnlineMap/routes/+layout.svelte"),
			read("../src/routes/(gc)/+layout.svelte"),
			read("../../ReTreever/src/routes/(getcache)/+layout@.svelte"),
		];
		for (const m of mounts) expect(m).toMatch(/isLandscapeRoute\(/);
	});
});
