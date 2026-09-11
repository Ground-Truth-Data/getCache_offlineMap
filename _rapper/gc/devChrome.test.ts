/**
 * A POSTER OF A PAGE MUST NOT BRING THE PAGE'S INSTRUMENTS.
 *
 * The wiki pages render a child's whole +page.svelte to show the real app, and
 * that child mounts its own dev rails. They arrived with it — over the phone
 * and beside the copy — on a page whose whole job is to be read. The child
 * cannot know it is a poster, so only the URL can answer.
 */
import { describe, expect, it } from "vitest";
import { NOT_ON, devChromeShows } from "./devChrome";

const at = (path: string) => new URL(path, "http://getcache.localhost");

describe("devChromeShows", () => {
	it("keeps instruments off every wiki page", () => {
		expect(devChromeShows(at("/wiki/offline"))).toBe(false);
		expect(devChromeShows(at("/wiki/map"))).toBe(false);
	});

	it("leaves the real app alone", () => {
		for (const p of ["/app/offlinev10", "/app/map", "/app/inbox"])
			expect(devChromeShows(at(p))).toBe(true);
	});

	it("takes a whole segment, never a substring", () => {
		// "/app/wikipedia" is not a wiki page; a substring match would hide its rails.
		expect(devChromeShows(at("/app/wikipedia"))).toBe(true);
	});

	it("covers every word it claims to", () => {
		for (const word of NOT_ON) expect(devChromeShows(at(`/${word}/thing`))).toBe(false);
	});
});
