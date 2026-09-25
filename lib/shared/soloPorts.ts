/**
 * Ports for a host with no app behind it. The map calls these every pass and
 * does not check for holes; these are the honest empty answers, not placeholders.
 *
 * ⚠️ `ready()` is TRUE: the engine evicts on "hydrating" vs "no places", and a
 * solo host has nothing to hydrate.
 */
import type { Component } from "svelte";
import type { HostPlace, HostPorts } from "./hostPorts";
import type { MapGpsPorts, MapHostPorts, MapHostStore, MapUiPorts } from "./mapHostPorts";

/** `any`: one stub stands in for every port component, whatever its props. */
const Empty = (() => {}) as unknown as Component<any>;

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

export function soloHostPorts(): HostPorts {
	return {
		places: (): HostPlace[] => [],
		ready: () => true,
		onPlacesChanged: () => () => {},
	};
}

/** The camera alone — never empty: an empty fire layer reads as "no fires near you". */
export function soloFireOrigins(
	mapCentre: readonly [number, number],
): Array<readonly [number, number]> {
	return [mapCentre];
}
