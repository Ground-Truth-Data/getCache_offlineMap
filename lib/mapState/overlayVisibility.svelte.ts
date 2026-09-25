// snake-ruler is a LIVE measuring tool, not a saved layer — no visibility toggle here

const browser = typeof window !== "undefined";

// fires defaults ON and RE-ARMS ITSELF (FIRE_HIDE_TTL_MS) so hiding it can never become a silent standing preference
export type OverlayKind = "pins" | "plots" | "shapes" | "pdf" | "fires";

const STORAGE_KEY = "retreever-overlay-visibility";
const FIRE_HIDDEN_AT_KEY = "retreever-fires-hidden-at";

export const FIRE_HIDE_TTL_MS = 12 * 60 * 60 * 1000;

type VisState = Record<OverlayKind, boolean>;

const DEFAULTS: VisState = {
	pins: true,
	plots: true,
	shapes: true,
	pdf: true,
	fires: true,
};

// every failure path lands on SHOWING fires (fail open, not closed)
function fireHideExpired(): boolean {
	try {
		const at = Number(localStorage.getItem(FIRE_HIDDEN_AT_KEY));
		if (!Number.isFinite(at) || at <= 0) return true;
		return Date.now() - at >= FIRE_HIDE_TTL_MS;
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
		return {
			pins: parsed.pins ?? true,
			plots: parsed.plots ?? true,
			shapes: parsed.shapes ?? true,
			pdf: parsed.pdf ?? true,
			fires: (parsed.fires ?? true) || fireHideExpired(),
		};
	} catch {
		return { ...DEFAULTS };
	}
}

const state = $state<VisState>(load());

if (browser && state.fires) {
	try {
		if (localStorage.getItem(FIRE_HIDDEN_AT_KEY) !== null) {
			localStorage.removeItem(FIRE_HIDDEN_AT_KEY);
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		}
	} catch {
		// codestyle-allow-swallow: a blocked localStorage must not break the map.
	}
}

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
	isVisible(kind: OverlayKind): boolean {
		return state[kind];
	},
	toggle(kind: OverlayKind): void {
		this.set(kind, !state[kind]);
	},
	set(kind: OverlayKind, visible: boolean): void {
		state[kind] = visible;
		if (kind === "fires" && browser) {
			try {
				if (visible) localStorage.removeItem(FIRE_HIDDEN_AT_KEY);
				else localStorage.setItem(FIRE_HIDDEN_AT_KEY, String(Date.now()));
			} catch {
				// codestyle-allow-swallow: a blocked localStorage must not break the map.
			}
		}
		persist();
	},
};
