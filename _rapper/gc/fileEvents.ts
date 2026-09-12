// File-lifecycle DOM events — the ONE wire between "a file moved" and the
// celebration arms (celebrate.svelte.ts listens: export → RIGHT thumbs-up,
// import → LEFT thumbs-up, both on the shared every-other pacing gate).
//
// Announce at the ACTION level, not the transport level: an export counts
// whether it left via the native share sheet, the Web Share API, or the
// browser download leg — the user doesn't care which tier fired. Every
// export transport calls announceExport at its success point; importRouter
// (the single import funnel) calls announceImport.
//
// the harness's shareFile dispatches the export event with an inline string —
// open-core rule: it cannot import this proprietary module. Keep the
// literals in sync with mapShareFeature.ts.

export const FILE_EXPORTED_EVENT = "getcache:file-exported";
export const FILE_IMPORTED_EVENT = "getcache:file-imported";

export function announceExport(filename: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent(FILE_EXPORTED_EVENT, { detail: { filename } }),
	);
}

export function announceImport(filename: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent(FILE_IMPORTED_EVENT, { detail: { filename } }),
	);
}
