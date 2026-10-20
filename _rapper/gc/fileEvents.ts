// Announce at the ACTION level, not the transport level: every export transport
// (share sheet, Web Share API, download) calls announceExport at its success point.

export const FILE_EXPORTED_EVENT = "getcache:file-exported";
export const FILE_IMPORTED_EVENT = "getcache:file-imported";

export function announceExport(filename: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent(FILE_EXPORTED_EVENT, { detail: { filename } }),
	);
}

export type ImportedDetail = { filename: string; landed: boolean };

/** `landed: false` is a refusal: the logs page repaints, nothing celebrates. */
export function announceImport(filename: string, landed = true): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<ImportedDetail>(FILE_IMPORTED_EVENT, { detail: { filename, landed } }),
	);
}

export const landedImport = (e: Event): boolean =>
	(e as CustomEvent<ImportedDetail>).detail?.landed === true;
