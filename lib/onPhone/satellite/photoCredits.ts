import * as maplibregl from "maplibre-gl";
import { SATELLITE_SOURCES } from "../../contract/satelliteSources";

let control: maplibregl.AttributionControl | null = null;
let slot: HTMLElement | null = null;
const place = (): void => void (control?._container && slot?.replaceChildren(control._container));

/** The map's ⓘ: closed at first, a tap opens it. MapLibre opens compact credits on their first entry, so that one is closed again.
 * It stands on the shovel's blade (`shovelCredits`), so it rides with the drawer. */
export function creditsControl(): maplibregl.AttributionControl {
	const made = new maplibregl.AttributionControl({ compact: true });
	const compact = made._updateCompact;
	made._updateCompact = () => {
		const first = !made._container.classList.contains("maplibregl-compact");
		compact();
		if (first) made._updateCompactMinimize();
	};
	const onAdd = made.onAdd.bind(made);
	made.onAdd = (map) => {
		const el = onAdd(map);
		control = made;
		queueMicrotask(place);
		return el;
	};
	return made;
}

/** ShovelHandle's slot on the blade: whichever comes second, the slot or the map's credits, puts them there. */
export function shovelCredits(node: HTMLElement): () => void {
	slot = node;
	place();
	return () => void (slot === node && (slot = null));
}

/** Photos are image sources, which carry no attribution; their credits ride the ⓘ as custom ones. MapTiler's terms
 * (§6) want its credit seen, so the ⓘ opens itself when its imagery comes on screen; a tap still closes it. */
export function setPhotoCredits(made: maplibregl.AttributionControl, credits: string[]): void {
	const was = made.options.customAttribution;
	const maptiler = SATELLITE_SOURCES.maptiler.attribution;
	if (credits.includes(maptiler) && !(Array.isArray(was) && was.includes(maptiler))) {
		made._container.classList.add("maplibregl-compact-show");
		made._container.setAttribute("open", "");
	}
	made.options.customAttribution = credits;
	made._updateAttributions();
}
