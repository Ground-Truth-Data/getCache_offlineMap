import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE CARD MUST NOT COVER THE BARS. A centred card sized against the bare
 * viewport runs under the top bar and the tab bar, and its own gold edge lands
 * part-way down the tab bar — which reads as the FOOTER being broken rather
 * than the card overhanging it. That was the shape of the bug: the footer was
 * measurably identical to the app's the whole time.
 */
const read = (rel: string) =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const card = read("./SideCard.svelte");
const gcLayout = read(
	"../../ReTreever/src/routes/(getcache)/+layout@.svelte",
);

const centredRule = () =>
	card
		.slice(card.indexOf(".side-card--centred {"))
		.slice(0, card.slice(card.indexOf(".side-card--centred {")).indexOf("}"))
		.replace(/\/\*[\s\S]*?\*\//g, "");

describe("a floating card keeps off the host chrome", () => {
	it("subtracts the chrome from its height, not just the gutter", () => {
		expect(centredRule()).toMatch(/max-height:[\s\S]*--host-chrome/);
	});

	// Centring on the window puts the card too low in the space left over: the
	// two bars are different heights, so the leftover box is not centred on it.
	it("shifts by half the difference, because the bars are not symmetrical", () => {
		const rule = centredRule();
		expect(rule).toMatch(/--host-chrome-top/);
		expect(rule).toMatch(/--host-chrome-bottom/);
	});
});

describe("the chrome height is actually published", () => {
	// It was read in three places and set in none, so it fell back to 0px on
	// every Get Cache page. A var only ever read is a var that is always zero.
	it("is set by the layout that decides whether each bar is drawn", () => {
		expect(gcLayout).toMatch(/setProperty\(\s*"--host-chrome"/);
		expect(gcLayout).toMatch(/setProperty\(\s*"--host-chrome-top"/);
		expect(gcLayout).toMatch(/setProperty\(\s*"--host-chrome-bottom"/);
	});

	it("counts each bar only when that bar is drawn", () => {
		expect(gcLayout).toMatch(/topBar\s*\?\s*TOP_BAR_PX\s*:\s*0/);
		expect(gcLayout).toMatch(/bottomBar\s*\?\s*BOTTOM_BAR_PX\s*:\s*0/);
	});
});
