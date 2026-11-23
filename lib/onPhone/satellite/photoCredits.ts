import * as maplibregl from "maplibre-gl";

let control: maplibregl.AttributionControl | null = null;
let slot: HTMLElement | null = null;
const place = (): void => void (control?._container && slot?.replaceChildren(control._container));

/** The map's credits, always open: a folded ⓘ read as nothing on the map (Chris, 23 Nov 2026).
 * They stand on the shovel's blade (`shovelCredits`), so they ride with the drawer. */
export function creditsControl(): maplibregl.AttributionControl {
	const made = new maplibregl.AttributionControl({ compact: false });
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

/** Photos are image sources, which carry no attribution; their credits ride along as custom ones. */
export function setPhotoCredits(made: maplibregl.AttributionControl, credits: string[]): void {
	made.options.customAttribution = credits;
	made._updateAttributions();
}
