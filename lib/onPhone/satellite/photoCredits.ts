import * as maplibregl from "maplibre-gl";
import { SATELLITE_SOURCES } from "../../contract/satelliteSources";

/** The map's ⓘ: closed at first, a tap opens it. MapLibre opens compact credits on their first entry, so that one is closed again. */
export function creditsControl(): maplibregl.AttributionControl {
	const control = new maplibregl.AttributionControl({ compact: true });
	const compact = control._updateCompact;
	control._updateCompact = () => {
		const first = !control._container.classList.contains("maplibregl-compact");
		compact();
		if (first) control._updateCompactMinimize();
	};
	return control;
}

/** Photos are image sources, which carry no attribution; their credits ride the ⓘ as custom ones. MapTiler's terms
 * (§6) want its credit visible whenever its imagery is: while one of its photos is up, the credits never collapse. */
export function setPhotoCredits(control: maplibregl.AttributionControl, credits: string[]): void {
	const open = credits.includes(SATELLITE_SOURCES.maptiler.attribution);
	control._compact = !open;
	if (open) control._container.classList.remove("maplibregl-compact", "maplibregl-compact-show");
	control.options.customAttribution = credits;
	control._updateAttributions();
}
