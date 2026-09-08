/**
 * THE PORTS A HOST WITH NO APP BEHIND IT SUPPLIES.
 *
 * A tier that mounts this child without the surrounding Get Cache app — rapper,
 * or a bare `npm create` install — still has to hand the map a full port
 * bundle: the map calls these on every pass and does not check for holes. These
 * are the honest empty answers, NOT placeholders to be filled in later. A tier
 * WITH an app (ReTreever) passes its own; nothing here is a fallback for that.
 *
 * ⚠️ `ready()` returns TRUE. A host still hydrating looks "empty" but is not
 * "no places", and the engine evicts on that difference — a solo host has
 * nothing to hydrate, so it is ready from the first frame.
 */
import type { Component } from "svelte";
import type { HostPlace, HostPorts } from "./hostPorts";
import type { MapGpsPorts, MapHostPorts, MapHostStore, MapUiPorts } from "./mapHostPorts";

/** Renders nothing. The map draws its own chrome; host furniture is the host's. */
const Empty = (() => {}) as unknown as Component<Record<string, unknown>>;

/** An eye that never animates: one frame, no timers to leak. */
const stillEye = () => ({
	srcFor: () => "",
	blinkThen: async (action: () => void) => action(),
	destroy: () => {},
});

export function soloMapPorts(): MapHostPorts {
	const store: MapHostStore = {
		activeMapKey: null,
		activeMap: null,
		allMaps: [],
		features: [],
		ready: true,
		onActiveMapChange: () => () => {},
		addFeature: () => "",
		updateFeature: () => {},
		deleteFeature: () => {},
	};

	const ui: MapUiPorts = {
		Icon: Empty,
		MaskedIcon: Empty,
		MaskedFrameIcon: Empty,
		EmojiPin: Empty,
		GoldButton: Empty,
		SharePicker: Empty,
		FeatureDetail: Empty,
		CrowSwitch: Empty,
		copyToClipboard: async (text: string) => {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				return false;
			}
		},
		reportSwallowed: (scope, err) => console.warn(`[${scope}]`, err),
		overlayPortal: () => {},
		createEyeToggle: () => ({
			srcFor: () => "",
			isSettledOff: () => true,
			play: () => {},
			destroy: () => {},
		}),
		createEyeBlink: stillEye,
		eyeAllFrames: [],
	};

	const gps: MapGpsPorts = {
		isGranted: async () => false,
		reportError: (scope, err) => console.warn(`[${scope}]`, err),
	};

	return { store, ui, gps };
}

/**
 * No places, and none can be added: a solo host owns no store to write one to.
 * The map still downloads whatever the user pins by hand — that path goes
 * through the blob service, not through here.
 */
export function soloHostPorts(): HostPorts {
	return {
		places: (): HostPlace[] => [],
		ready: () => true,
		onPlacesChanged: () => () => {},
	};
}

/**
 * The anchor set for a host with no map store: the camera, alone.
 *
 * This is the SAME answer the full implementation gives when a user has no fix
 * and no touched ground — the deliberate last resort, because an empty fire
 * layer reads as "no fires near you", which is the most dangerous thing that
 * layer can say. A solo host is permanently in that state, so it is not a
 * degraded stand-in; it is the whole correct answer for a host with no anchors.
 */
export function soloFireOrigins(
	mapCentre: readonly [number, number],
): Array<readonly [number, number]> {
	return [mapCentre];
}
