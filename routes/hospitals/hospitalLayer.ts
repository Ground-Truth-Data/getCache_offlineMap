/**
 * hospitalLayer — the hospital pins, ONE implementation for both maps (the
 * online Mapbox map and the offline MapLibre map): the same teardrop pin,
 * icon-only clusters under z11, and one tap card in the fire card's clothes.
 * Paints from hospitalCache; never fetches — it asks (`wantHospitals`) and the
 * pass answers. No text layers: the two maps have different glyph servers, and
 * a symbol layer whose glyphs 404 stalls its whole source.
 */

import type maplibregl from "maplibre-gl";
import hospitalPinUrl from "$parent/siblings/getCache_OnlineMap/lib/assets/mobileAssets/hospitalPin.webp";
import { isMaplibreMap, popupCtor } from "../../lib/shared/rendererOf";
import { distKm } from "../fires/fireRelevance";
import {
	hospitalCollection,
	type LngLat,
	onHospitals,
	wantHospitals,
} from "./hospitalCache";

export const HOSPITAL_LAYER_IDS = {
	src: "rt-hospital-geo",
	cluster: "rt-hospital-cluster",
	icon: "rt-hospital-icon",
} as const;

/** The visible layers, for the legend rows and paint checks. */
export const HOSPITAL_LAYER_ID_LIST: readonly string[] = [
	HOSPITAL_LAYER_IDS.cluster,
	HOSPITAL_LAYER_IDS.icon,
];

const PIN = "rt-hospital-pin";
const PIN_SIZE = 0.47;
const MIN_ZOOM = 6.5;
const POPUP_OFFSET = 22;

const EMPTY: GeoJSON.FeatureCollection = {
	type: "FeatureCollection",
	features: [],
};

export interface HospitalLayerHandle {
	(): void;
	repaint: () => void;
}

export interface HospitalLayerOptions {
	/** Where the user has a stake: live fix, pins touched lately. The wall is measured from these, never the screen. */
	readonly origins: () => readonly LngLat[];
	/** The card's "My location" button — the app's own locate action, never raw geolocation here. Omitted → no button. */
	readonly onShowMyLocation?: () => void;
}

type Popup = maplibregl.Popup;

// MapLibre v4 `loadImage(url)` returns a promise; Mapbox 3 takes a callback
// and ignores a missing one, so a promise wrapped around it never settles.
function loadImage(
	map: maplibregl.Map,
	url: string,
): Promise<HTMLImageElement | ImageBitmap> {
	if (isMaplibreMap(map)) return map.loadImage(url).then((r) => r.data);
	return new Promise((resolve, reject) => {
		(
			map as unknown as {
				loadImage: (
					u: string,
					cb: (
						err: Error | null | undefined,
						img?: HTMLImageElement | ImageBitmap | null,
					) => void,
				) => void;
			}
		).loadImage(url, (err, img) => {
			if (err || !img) reject(err ?? new Error("no image"));
			else resolve(img);
		});
	});
}

function addLayers(map: maplibregl.Map): void {
	if (map.getSource(HOSPITAL_LAYER_IDS.src)) return;
	map.addSource(HOSPITAL_LAYER_IDS.src, {
		type: "geojson",
		data: EMPTY,
		cluster: true,
		clusterRadius: 120,
		clusterMaxZoom: 11,
	});
	// A cluster shows the same pin — in an emergency the user zooms in anyway.
	map.addLayer({
		id: HOSPITAL_LAYER_IDS.cluster,
		type: "symbol",
		source: HOSPITAL_LAYER_IDS.src,
		filter: ["has", "point_count"],
		minzoom: MIN_ZOOM,
		layout: {
			"icon-image": PIN,
			"icon-size": PIN_SIZE,
			"icon-allow-overlap": true,
			"icon-anchor": "bottom",
		},
	});
	map.addLayer({
		id: HOSPITAL_LAYER_IDS.icon,
		type: "symbol",
		source: HOSPITAL_LAYER_IDS.src,
		filter: ["!", ["has", "point_count"]],
		minzoom: MIN_ZOOM,
		layout: {
			"icon-image": PIN,
			"icon-size": PIN_SIZE,
			"icon-allow-overlap": false,
			// the pin is a teardrop whose TIP is the coordinate; `center` drifts by half an icon-height of pixels as you zoom
			"icon-anchor": "bottom",
		},
	});
}

const esc = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const COPY_GLYPH =
	'<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

export function hospitalCardHtml(opts: {
	readonly name: string;
	readonly phone?: string | null;
	readonly fromYouKm?: number | null;
	readonly locateButton: boolean;
}): string {
	// The number copies on tap (and from the little button beside it) — in the
	// field it goes into a text or the sat phone, not this device's dialler.
	const phoneRow = opts.phone
		? `<div class="rt-hospital-row"><span class="rt-hospital-k">Phone</span><span class="rt-hospital-v"><button type="button" class="rt-hospital-tel" data-copy="${esc(opts.phone)}">${esc(opts.phone)}</button><button type="button" class="rt-hospital-copy" data-copy="${esc(opts.phone)}" aria-label="Copy phone number">${COPY_GLYPH}</button></span></div>`
		: "";
	const fromRow =
		opts.fromYouKm != null && Number.isFinite(opts.fromYouKm)
			? `<div class="rt-hospital-row"><span class="rt-hospital-k">From you</span><span class="rt-hospital-v">${Math.round(opts.fromYouKm)} km</span></div>`
			: "";
	const locate = opts.locateButton
		? `<button type="button" class="rt-hospital-loc">My location</button>`
		: "";
	return (
		`<div class="rt-hospital-card">` +
		`<div class="rt-hospital-head"><img class="rt-hospital-pinimg" src="${hospitalPinUrl}" alt="" aria-hidden="true" decoding="async"/><h4>${esc(opts.name)}</h4></div>` +
		phoneRow +
		fromRow +
		(locate ? `<div class="rt-hospital-actions">${locate}</div>` : "") +
		`</div>`
	);
}

// The renderer focuses the close button on open; on the iOS WebView the first
// touch on a freshly-focused control is eaten as a focus gesture and `click`
// never fires. `pointerup` is delivered straight from the input pipeline.
function wireCloseButton(popup: Popup): void {
	const btn = popup
		.getElement()
		?.querySelector<HTMLButtonElement>(
			".maplibregl-popup-close-button, .mapboxgl-popup-close-button",
		);
	if (!btn) return;
	btn.blur();
	let closed = false;
	btn.addEventListener("pointerup", (e) => {
		if (closed) return;
		closed = true;
		e.preventDefault();
		e.stopPropagation();
		popup.remove();
	});
}

async function copyPhone(
	card: HTMLElement | undefined,
	text: string,
): Promise<void> {
	if (!text) return;
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		document.execCommand("copy");
		ta.remove();
	}
	const copy = card?.querySelector<HTMLButtonElement>(".rt-hospital-copy");
	if (!copy) return;
	copy.classList.add("is-copied");
	copy.innerHTML = "Copied";
	setTimeout(() => {
		copy.classList.remove("is-copied");
		copy.innerHTML = COPY_GLYPH;
	}, 1400);
}

function nearestKm(at: LngLat, origins: readonly LngLat[]): number | null {
	let best = Number.POSITIVE_INFINITY;
	for (const o of origins) best = Math.min(best, distKm(o, at));
	return Number.isFinite(best) ? best : null;
}

/**
 * Attach the hospital layer. Paints the cache, asks the pass for the anchors'
 * discs, repaints as they land. Returns a disposer that also carries
 * `repaint()`.
 */
export function attachHospitalLayer(
	map: maplibregl.Map,
	opts: HospitalLayerOptions,
): HospitalLayerHandle {
	let live = true;
	const isLive = (): boolean => live;
	let popup: Popup | null = null;

	const paint = async (): Promise<void> => {
		const fc = await hospitalCollection(opts.origins());
		if (!isLive() || !map.getStyle()) return;
		addLayers(map);
		const src = map.getSource(HOSPITAL_LAYER_IDS.src) as
			| maplibregl.GeoJSONSource
			| undefined;
		src?.setData(fc);
	};

	const ready: Promise<void> = map.hasImage(PIN)
		? Promise.resolve()
		: loadImage(map, hospitalPinUrl).then(
				(img) => {
					if (isLive() && !map.hasImage(PIN)) map.addImage(PIN, img);
				},
				(err) => {
					console.warn(
						"[hospitals] pin icon failed to load — hospitals will NOT render",
						err,
					);
				},
			);
	const repaint = (): void => {
		void ready.then(paint);
	};
	repaint();
	wantHospitals(opts.origins());
	const offLanded = onHospitals(repaint);
	// A style swap (basemap picker) drops every custom layer; put them back.
	const onStyle = (): void => {
		if (!map.hasImage(PIN)) {
			void loadImage(map, hospitalPinUrl).then((img) => {
				if (isLive() && !map.hasImage(PIN)) map.addImage(PIN, img);
				repaint();
			});
		} else repaint();
	};
	map.on("style.load", onStyle);

	const show = (
		at: LngLat,
		props: Record<string, unknown> | null | undefined,
	): void => {
		popup?.remove();
		const PopupCtor = popupCtor(map) as unknown as new (o: unknown) => Popup;
		popup = new PopupCtor({
			closeButton: true,
			maxWidth: "280px",
			className: "rt-hospital-popup",
			offset: POPUP_OFFSET,
		});
		popup
			.setLngLat([at[0], at[1]])
			.setHTML(
				hospitalCardHtml({
					name: typeof props?.name === "string" ? props.name : "Hospital",
					phone: typeof props?.phone === "string" ? props.phone : null,
					fromYouKm: nearestKm(at, opts.origins()),
					locateButton: opts.onShowMyLocation !== undefined,
				}),
			)
			.addTo(map);
		wireCloseButton(popup);
		const el = popup.getElement();
		el?.querySelector<HTMLButtonElement>(".rt-hospital-loc")?.addEventListener(
			"click",
			() => {
				popup?.remove();
				opts.onShowMyLocation?.();
			},
		);
		for (const b of el?.querySelectorAll<HTMLButtonElement>("[data-copy]") ??
			[])
			b.addEventListener(
				"click",
				() => void copyPhone(el, b.dataset.copy ?? ""),
			);
	};
	const onIcon = (e: maplibregl.MapLayerMouseEvent): void => {
		const f = e.features?.[0];
		if (!f || f.geometry.type !== "Point") return;
		const [lng, lat] = f.geometry.coordinates;
		show([lng, lat], f.properties);
	};
	// A cluster names its first member: in an emergency the user zooms in anyway.
	const onCluster = (e: maplibregl.MapLayerMouseEvent): void => {
		const f = e.features?.[0];
		if (!f || f.geometry.type !== "Point") return;
		const [lng, lat] = f.geometry.coordinates;
		const src = map.getSource(HOSPITAL_LAYER_IDS.src) as
			| maplibregl.GeoJSONSource
			| undefined;
		const id = Number(f.properties?.cluster_id);
		if (!src || !Number.isFinite(id)) {
			show([lng, lat], null);
			return;
		}
		// Mapbox's getClusterLeaves takes a callback and returns nothing; MapLibre's returns a promise.
		const done = (leaves: GeoJSON.Feature[] | null | undefined): void => {
			if (!isLive()) return;
			const leaf = leaves?.[0];
			const at: LngLat =
				leaf?.geometry?.type === "Point"
					? [leaf.geometry.coordinates[0], leaf.geometry.coordinates[1]]
					: [lng, lat];
			show(at, leaf?.properties);
		};
		if (isMaplibreMap(map)) {
			void src.getClusterLeaves(id, 1, 0).then(done, () => done(null));
		} else {
			(
				src as unknown as {
					getClusterLeaves: (
						id: number,
						limit: number,
						offset: number,
						cb: (err: unknown, leaves?: GeoJSON.Feature[]) => void,
					) => void;
				}
			).getClusterLeaves(id, 1, 0, (err, leaves) => done(err ? null : leaves));
		}
	};
	map.on("click", HOSPITAL_LAYER_IDS.icon, onIcon);
	map.on("click", HOSPITAL_LAYER_IDS.cluster, onCluster);

	const handle = (): void => {
		live = false;
		offLanded();
		popup?.remove();
		popup = null;
		map.off("style.load", onStyle);
		map.off("click", HOSPITAL_LAYER_IDS.icon, onIcon);
		map.off("click", HOSPITAL_LAYER_IDS.cluster, onCluster);
	};
	handle.repaint = () => {
		repaint();
		wantHospitals(opts.origins());
	};
	return handle;
}
