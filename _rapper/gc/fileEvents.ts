// Announce at the ACTION level, not the transport level: every export transport
// (share sheet, Web Share API, download) calls announceExport at its success point.
// rapper's own shareFile dispatches this event with an inline string literal — open-core
// rule bars it from importing this module — so keep the literals in sync with mapShareFeature.ts.

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
