import { configureTilesHost, configureTilesDevHost } from "./tilesHost";

export function configureTilesFromEnv(): void {
	const host = import.meta.env.PUBLIC_GC_tiles_prod_worker;
	if (typeof host === "string" && host.trim() !== "") {
		configureTilesHost(host);
	} else if (import.meta.env.DEV) {
		console.warn(
			"[tiles] ⛔ PUBLIC_GC_tiles_prod_worker is not set — NOTHING will download " +
				"(no /pack request is sent at all; the satellite layer still draws, " +
				"so this looks like 'roads are broken'). Put it in the .env beside " +
				"vite's root — the wrapper folder, not the project root:\n" +
				// Placeholder only: noParentNames.test.ts forbids a real origin here.
				"    PUBLIC_GC_tiles_prod_worker=https://<your-tiles-worker>",
		);
	}

	const devHost = import.meta.env.PUBLIC_GC_tiles_dev_worker;
	if (typeof devHost === "string" && devHost.trim() !== "") {
		configureTilesDevHost(devHost);
	}
}
