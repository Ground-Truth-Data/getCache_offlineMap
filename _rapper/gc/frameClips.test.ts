import { describe, expect, it } from "vitest";
import { clipMs, frameUrl, frameUrls, loadClips, type ClipFacts } from "./frameClips";

const facts: ClipFacts = { section: "dog", frameCount: 3, fps: 24, widthRem: 36, note: "t" };

describe("frameClips", () => {
	it("builds zero-padded frame paths under the root's section folder", () => {
		expect(frameUrl("/rt_anime", "dog-blink", facts, 2)).toBe(
			"/rt_anime/dog/dog-blink/dog-blink_002.webp",
		);
		expect(frameUrls("https://x.org/rt_anime", "dog-blink", facts)).toEqual([
			"https://x.org/rt_anime/dog/dog-blink/dog-blink_001.webp",
			"https://x.org/rt_anime/dog/dog-blink/dog-blink_002.webp",
			"https://x.org/rt_anime/dog/dog-blink/dog-blink_003.webp",
		]);
	});

	it("times a clip from its count and fps", () => {
		expect(clipMs({ ...facts, frameCount: 163, fps: 24 })).toBe(6792);
	});

	it("loads clips.json from the root and refuses a missing one", async () => {
		const manifest = { states: { opaque: [0, 29] }, clips: { "dog-blink": facts } };
		const ok = (async () => new Response(JSON.stringify(manifest))) as unknown as typeof fetch;
		expect(await loadClips("/rt_anime", ok)).toEqual(manifest);
		const gone = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
		await expect(loadClips("/rt_anime", gone)).rejects.toThrow("404");
	});
});
