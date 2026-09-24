import { noteProbe } from "../../shared/workMeter.svelte";
// No production host is baked in: a hardcoded default bills the maintainer's R2
// account for every stranger who installs this package.
let configuredHost: string | null = null;
let configuredDevHost: string | null = null;

/** Call once at app boot, before any tile fetch. */
export function configureTilesHost(host: string): void {
	configuredHost = host.trim().replace(/\/+$/, "") || null;
}

export function configureTilesDevHost(host: string): void {
	configuredDevHost = host.trim().replace(/\/+$/, "") || null;
}

export function isTilesHostConfigured(): boolean {
	return configuredHost !== null;
}
const LOCAL_HOST_NAME = "tiles-local.getcache.org:8787";
export const LOCAL_DEV_HOST = `http://${LOCAL_HOST_NAME}`;

export type WorkerTarget = "worker-cloud-prod" | "worker-cloud-dev" | "worker-local-dev";

export function hostFor(t: WorkerTarget): string | null {
	if (t === "worker-local-dev") return LOCAL_DEV_HOST;
	if (t === "worker-cloud-dev") return configuredDevHost;
	return configuredHost;
}

// Dev builds only: a shipped build never reads this, because getWorkerTarget()'s
// !DEV early return locks phones to production.
export const DEFAULT_TARGET: WorkerTarget = "worker-cloud-dev";

const OVERRIDE_KEY = "rt_worker_target";

// Only a human click moves the target; a machine fallback to production bills
// the maintainer's R2 on every fresh install. Dead-and-selected is a valid state.
export function getWorkerTarget(): WorkerTarget {
	if (!import.meta.env.DEV) return "worker-cloud-prod";
	try {
		const v = sessionStorage.getItem(OVERRIDE_KEY);
		if (v === "worker-cloud-prod" || v === "worker-cloud-dev" || v === "worker-local-dev") return v;
		if (v === "production") return "worker-cloud-prod";
		if (v === "r2Dev") return "worker-cloud-dev";
		if (v === "localDev") return "worker-local-dev";
	} catch {
		// codestyle-allow-swallow: sessionStorage unavailable in SSR/private mode
	}
	return DEFAULT_TARGET;
}

export function setWorkerTarget(t: WorkerTarget): void {
	if (!import.meta.env.DEV) return;
	try {
		sessionStorage.setItem(OVERRIDE_KEY, t);
	} catch {
		// codestyle-allow-swallow: default target stays in force
	}
}

// Functions, not constants: a const read at module load cannot see a target chosen later.
export function tilesHost(): string | null {
	return hostFor(getWorkerTarget());
}

/** null when unconfigured; callers must check or null interpolates into "null/pack". */
export function packUrl(): string | null {
	const h = tilesHost();
	if (h !== lastAnnouncedPackHost) {
		lastAnnouncedPackHost = h;
		if (h === null) {
			console.error(
				`[tiles] ⛔ NO HOST for target "${getWorkerTarget()}" — no /pack request will be sent. ` +
					"Nothing will appear in the Network tab. Set VITE_TILES_HOST (or pick a reachable target).",
			);
		} else {
			console.info(`[tiles] ✅ /pack will be fetched from ${h}`);
		}
	}
	return h === null ? null : `${h}/pack`;
}

/** undefined = never announced, null = announced as unconfigured. */
let lastAnnouncedPackHost: string | null | undefined;

export function firesUrl(): string | null {
	const h = tilesHost();
	return h === null ? null : `${h}/fires`;
}

export function tileUrl(z: number, x: number, y: number): string | null {
	const h = tilesHost();
	return h === null ? null : `${h}/${z}/${x}/${y}.pbf`;
}

/** Through our Worker, never MapTiler direct: the key stays on the Worker. */
export function satelliteTileUrl(z: number, x: number, y: number): string | null {
	const h = tilesHost();
	return h === null ? null : `${h}/satellite/${z}/${x}/${y}.jpg`;
}

export function hospitalsUrl(
	lng: number,
	lat: number,
	km: number,
): string | null {
	const h = tilesHost();
	return h === null ? null : `${h}/hospitals?lng=${lng}&lat=${lat}&km=${km}`;
}

export const TILES_HOST_LABEL = "see tilesHost()";

const lastProbeFailure: Record<string, string> = {};

export async function probeTarget(
	t: WorkerTarget,
	timeoutMs = 1500,
): Promise<boolean> {
	const host = hostFor(t);
	if (host === null) return false;
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		// OPTIONS, never /bench: that is 500 range reads.
		await fetch(`${host}/pack`, {
			method: "OPTIONS",
			signal: ctl.signal,
			mode: "cors",
		});
		// Any answer, even 4xx, counts as up.
		noteProbe(t, true);
		return true;
	} catch (err) {
		const why = err instanceof Error ? err.message : String(err);
		noteProbe(t, false);
		if (lastProbeFailure[host] !== why) {
			lastProbeFailure[host] = why;
			const dns = /name not resolved|ERR_NAME|getaddrinfo|ENOTFOUND/i.test(why);
			console.warn(
				`[tiles] ${t} probe failed: ${why}` +
					(dns
						? ` — this is DNS, NOT the Worker. The name did not resolve, so nothing was ever contacted. If it was deployed recently a resolver may be caching "does not exist" for up to 30 min (check: dig +short ${new URL(host).hostname}).`
						: " — something answered the name but not the request."),
			);
		}
		return false;
	} finally {
		clearTimeout(timer);
	}
}
