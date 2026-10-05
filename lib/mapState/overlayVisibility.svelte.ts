// snake-ruler is a LIVE measuring tool, not a saved layer — no visibility toggle here

const browser = typeof window !== "undefined";

export type OverlayKind =
	| "pins"
	| "plots"
	| "shapes"
	| "pdf"
	| "fires"
	| "hospitals"
	| "labels";

// Safety layers RE-ARM THEMSELVES after REARM_TTL_MS, so hiding one can never become a silent standing preference.
export const REARMING: readonly OverlayKind[] = ["fires", "hospitals"];
export const REARM_TTL_MS = 12 * 60 * 60 * 1000;

const STORAGE_KEY = "retreever-overlay-visibility";
const hiddenAtKey = (kind: OverlayKind): string => `retreever-${kind}-hidden-at`;

type VisState = Record<OverlayKind, boolean>;

const DEFAULTS: VisState = {
	pins: true,
	plots: true,
	shapes: true,
	pdf: true,
	fires: true,
	hospitals: true,
	labels: true,
};

// every failure path lands on SHOWING (fail open, not closed)
function hideExpired(kind: OverlayKind): boolean {
	try {
		const at = Number(localStorage.getItem(hiddenAtKey(kind)));
		if (!Number.isFinite(at) || at <= 0) return true;
		return Date.now() - at >= REARM_TTL_MS;
	} catch {
		return true;
	}
}

function load(): VisState {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		const parsed = JSON.parse(raw) as Partial<VisState>;
		const loaded = { ...DEFAULTS };
		for (const kind of Object.keys(DEFAULTS) as OverlayKind[]) {
			loaded[kind] =
				(parsed[kind] ?? true) ||
				(REARMING.includes(kind) && hideExpired(kind));
		}
		return loaded;
	} catch {
		return { ...DEFAULTS };
	}
}

const state = $state<VisState>(load());

function persist(): void {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// codestyle-allow-swallow: a full/blocked localStorage must not break the map.
	}
}

export const overlayVisibility = {
	get pins() {
		return state.pins;
	},
	get plots() {
		return state.plots;
	},
	get shapes() {
		return state.shapes;
	},
	get pdf() {
		return state.pdf;
	},
	get fires() {
		return state.fires;
	},
	get hospitals() {
		return state.hospitals;
	},
	isVisible(kind: OverlayKind): boolean {
		return state[kind];
	},
	toggle(kind: OverlayKind): void {
		this.set(kind, !state[kind]);
	},
	set(kind: OverlayKind, visible: boolean): void {
		state[kind] = visible;
		if (REARMING.includes(kind) && browser) {
			try {
				if (visible) localStorage.removeItem(hiddenAtKey(kind));
				else localStorage.setItem(hiddenAtKey(kind), String(Date.now()));
			} catch {
				// codestyle-allow-swallow: a blocked localStorage must not break the map.
			}
		}
		persist();
	},
};
