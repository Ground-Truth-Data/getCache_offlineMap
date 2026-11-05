// ⚠️⚠️ DO NOT DELETE — shelved by Chris 5 Nov 2026. Pin photo discs and circles: a cool asset we will use again. Disconnected, not dead.
// ⚠️⚠️ Nothing imports this file. It is excluded from tests, type checks and builds. Read README.md beside it.

// The SAVE AREA tile and the open rule's hands: what the tile says, the spot a cellular open waits on, and where the
// camera goes when the map opens. Status lives on the tile, never in a popup.
import { m } from "$parent/src/lib/paraglide/messages";
import { queueBlob } from "$parent/siblings/getCache_OfflineMap/routes/offlinev10/blobService";
import { listRegions, photoCovering } from "$parent/siblings/getCache_OfflineMap/routes/offlinev10/store";
import { planOpen, readOpenLog, writeOpenLog } from "$parent/siblings/getCache_OfflineMap/routes/offlinev10/areaOpens";
import { onWifi, whereUrl } from "$parent/siblings/getCache_OfflineMap/lib/worker/tilesHost";

type LngLat = [number, number];

/** `centre`: the open map's, set while one is mounted. */
export const saveArea = $state<{ note: string | null; ask: LngLat | null; centre: (() => LngLat) | null }>({ note: null, ask: null, centre: null });

async function held(at: LngLat): Promise<boolean> {
	return !!photoCovering(at, await listRegions());
}

export async function saveHere(at: LngLat): Promise<void> {
	saveArea.ask = null;
	if (await held(at)) {
		saveArea.note = m.omap_save_area_held();
		return;
	}
	await queueBlob(at[0], at[1], { area: true });
	saveArea.note = m.omap_save_area_saving();
}

/** Back from the background this long is a new open. */
const RESUME_MS = 30 * 60_000;
let armed = true;
let hiddenAt = 0;
if (typeof document !== "undefined")
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) hiddenAt = Date.now();
		else if (hiddenAt && Date.now() - hiddenAt >= RESUME_MS) armed = true;
	});

export type OpenCamera = { at: LngLat; zoom: number } | "sample" | null;

/** GPS gets close enough that the photo fills the screen; the IP's spot is a town, so show the photo whole. */
const FIX_ZOOM = 14;
const ROUGH_ZOOM = 13;

/** The map opened, with the first fix or none. Once an open: returns where the camera should go. */
export async function mapOpened(fix: LngLat | null): Promise<OpenCamera> {
	if (!armed) return null;
	armed = false;
	const log = readOpenLog();
	const plan = planOpen(log, Date.now(), fix, { covered: !!fix && (await held(fix)), wifi: await onWifi() });
	writeOpenLog(plan.log);
	if (fix) {
		if (plan.download === "now") void saveHere(fix);
		if (plan.download === "ask") {
			saveArea.ask = fix;
			saveArea.note = m.omap_save_area_cellular();
		}
		return plan.zoom ? { at: fix, zoom: FIX_ZOOM } : null;
	}
	if (!plan.zoom) return null;
	if (log.last === undefined) return "sample";
	const rough = await roughSpot();
	if (!rough) return "sample";
	void saveHere(rough);
	return { at: rough, zoom: ROUGH_ZOOM };
}

/** Where the Worker's IP lookup puts this phone; no permission asked. */
async function roughSpot(): Promise<LngLat | null> {
	try {
		const res = await fetch(whereUrl() ?? "");
		if (res.status !== 200) return null;
		const { lng, lat } = (await res.json()) as { lng: number; lat: number };
		return [lng, lat];
	} catch (e) {
		console.warn("[saveArea] no rough location from the Worker", e);
		return null;
	}
}
