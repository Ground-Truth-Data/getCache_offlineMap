// Frame clips: a folder of numbered WebP frames per clip, declared by a
// clips.json the import script measures from the files. No hand-typed table
// anywhere — a count typed by hand is one frame off the day a clip is re-exported.

export type ClipFacts = {
	section: string;
	/** equals the file count in the clip's folder */
	frameCount: number;
	fps: number;
	/** rendered width on screen, a property of the art, not of the page */
	widthRem: number;
	note: string;
};

export type ClipManifest = {
	clips: Record<string, ClipFacts>;
};

// One manifest per root per page: the curtains, the dog and a dropdown each ask on mount.
const manifests = new Map<string, Promise<ClipManifest>>();

/** `root` is where clips.json and the frame folders are served from, no trailing slash. */
export function loadClips(root: string, fetchFn: typeof fetch = fetch): Promise<ClipManifest> {
	const cached = manifests.get(root);
	if (cached) return cached;
	const loading = (async () => {
		const res = await fetchFn(`${root}/clips.json`);
		if (!res.ok) throw new Error(`clips.json at ${root}: ${res.status}`);
		return (await res.json()) as ClipManifest;
	})();
	manifests.set(root, loading);
	loading.catch(() => manifests.delete(root));
	return loading;
}

export function forgetClips(): void {
	manifests.clear();
}

export function frameUrl(root: string, clip: string, facts: ClipFacts, frame: number): string {
	return `${root}/${facts.section}/${clip}/${clip}_${String(frame).padStart(3, "0")}.webp`;
}

export function frameUrls(root: string, clip: string, facts: ClipFacts): string[] {
	return Array.from({ length: facts.frameCount }, (_, i) => frameUrl(root, clip, facts, i + 1));
}

export function clipMs(facts: ClipFacts): number {
	return Math.round((facts.frameCount / facts.fps) * 1000);
}
