// Two sliders drive this: the inbox feature-detail SideSheet (primary) and the map page's layers panel (MapsLayersPanel2, secondary).
// Applier pattern (not Svelte reactive tracking across modules) — setPercent updates `value` then synchronously calls every registered applier.
// 0.5 default: a new overlay arrives half-transparent so the basemap stays readable; must match mobMapOverlay.ts's initial raster-opacity or there's a flash before the applier syncs.

type Applier = (opacity: number) => void;

class OverlayOpacityStore {
	value = $state(0.5);
	#appliers = new Set<Applier>();
	#key: string | undefined;

	/** `key` persists the value in localStorage; unkeyed stores reset on reload. */
	constructor(initial: number, key?: string) {
		this.value = initial;
		this.#key = key;
		if (!key || typeof localStorage === "undefined") return;
		try {
			const saved = localStorage.getItem(key);
			if (saved !== null && Number.isFinite(Number(saved)))
				this.value = Math.max(0, Math.min(1, Number(saved)));
		} catch {
			// codestyle-allow-swallow: a blocked localStorage just means the default.
		}
	}

	setPercent(pct: number): void {
		const next = Math.max(0, Math.min(100, pct)) / 100;
		this.value = next;
		if (this.#key) {
			try {
				localStorage.setItem(this.#key, String(next));
			} catch {
				// codestyle-allow-swallow: a blocked localStorage must not break the slider.
			}
		}
		for (const fn of this.#appliers) fn(next);
	}

	get percent(): number {
		return Math.round(this.value * 100);
	}

	/** Fires once on register with the current value; returns an unregister function — call it on unmount. */
	register(fn: Applier): () => void {
		this.#appliers.add(fn);
		fn(this.value);
		return () => {
			this.#appliers.delete(fn);
		};
	}
}

export const overlayOpacity = new OverlayOpacityStore(0.5);

// Blanket fill-opacity for ALL drawn polygons (Legend's Polygon-row slider). CENTRE-RESTING: 0.5 = as-designed, left fades toward zero, right boosts up to 2× (capped opaque). Outlines untouched.
export const polygonOpacity = new OverlayOpacityStore(0.5);

// How many labels the map shows (0 = none, 0.3 = the shipped look, 1 = busiest that still reads clean). Read by draw/labelDial.ts via MapDrawControls.
export const labelDensity = new OverlayOpacityStore(0.3, "retreever-label-density");
