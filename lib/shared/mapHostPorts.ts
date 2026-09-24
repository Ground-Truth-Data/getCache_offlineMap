/**
 * The map UI's door to its host. Structural types only, so the host never
 * imports this file to conform. Narrow: a member is here because lib/mapUi or
 * lib/mapState uses it. Optional groups (`q704?`, `scenes?`) exist only in
 * some hosts; a component that needs one renders nothing when it is absent.
 */
import type { Component } from "svelte";
import type { Feature } from "geojson";

/** A text label baked onto a PDF ground-overlay. */
export interface MapHostOverlayLabel {
	t: string;
	/** [lng, lat] */
	p: [number, number];
	/** Text height in ground metres. */
	m: number;
	/** Degrees clockwise. */
	r: number;
}

/** One feature row of the active map. */
export interface MapHostFeature {
	mapFeatureKey: string;
	featureName: string;
	featureType: string;
	featureDesc: string | null;
	featureData: string | null;
	contacts?: string[];
	geometry: Feature | null;
	lastEditedBy: string | null;
	importedCount: number | null;
	hectaresCalc: number | null;
	senderName: string | null;
	senderId: string | null;
	overlayStorageKey: string | null;
	overlayBounds: [number, number, number, number] | null;
	overlayCorners:
		| [[number, number], [number, number], [number, number], [number, number]]
		| null;
	overlayLabels: MapHostOverlayLabel[] | null;
	featureSource: string | null;
	madeWith: string;
	createdAt: string;
	lastTouched: string;
}

export interface MapHostSession {
	mapKey: string;
	mapTitle: string;
	landKey?: string | null;
	createdAt: string;
	lastTouched: string;
	senderName: string | null;
	senderId: string | null;
	features: MapHostFeature[];
}

export interface MapHostStore {
	readonly activeMapKey: string | null;
	readonly activeMap: MapHostSession | null;
	readonly allMaps: MapHostSession[];
	readonly features: Feature[];
	readonly ready: boolean;
	onActiveMapChange(fn: () => void): () => void;
	addFeature(
		geojsonFeature: Feature,
		featureType?: string,
		lastEditedBy?: string,
		username?: string | null,
		abstraction?: string | null,
		opts?: Record<string, unknown>,
	): string;
	/** Every key is named, never `[extra: string]`: an unlisted key must be a
	 *  build error, not a silent no-op in a host that drops it. Adding a key
	 *  means routing it in every host. */
	updateFeature(
		mapFeatureKey: string,
		patch: {
			name?: string;
			featureType?: string;
			featureDesc?: string;
			featureData?: string;
			contacts?: string[];
			geometry?: Feature | null;
			lastEditedBy?: string;
			/** The BLOCK this shape is the ground of, "" to release it. */
			landName?: string;
			/** Stored in the geometry's properties; `null`/`false`/`""` REMOVE the prop. */
			fillOpacity?: number | null;
			titleShown?: boolean;
			displayName?: string;
		},
	): void;
	deleteFeature(mapFeatureKey: string): void;
}

export interface IconProps {
	name: string;
	size?: number;
	stroke?: number;
	style?: string;
	class?: string;
}

/** One row of the host's share sheet. */
export interface MapShareRow {
	ext: string;
	label?: string;
	icon?: string;
	run: () => Promise<unknown> | unknown;
	[extra: string]: unknown;
}

/** THE definition; the host's kmzExport re-exports it. */
export type MapShareFormat = "getcache" | "kmz" | "kml";

export interface MapUiPorts {
	Icon: Component<IconProps>;
	MaskedIcon: Component<Record<string, unknown>>;
	EmojiPin: Component<Record<string, unknown>>;
	GoldButton: Component<Record<string, unknown>>;
	SharePicker: Component<Record<string, unknown>>;
	/** The feature editor body; host-owned because it edits the host's store. */
	FeatureDetail: Component<Record<string, unknown>>;
	CrowSwitch: Component<Record<string, unknown>>;
	copyToClipboard(text: string): Promise<boolean>;
	reportSwallowed(scope: string, err: unknown, extra?: Record<string, unknown>): void;
	/** TEMP remote diagnostic breadcrumb (host's /api/devlog). */
	devlog?(data: Record<string, unknown>): void;
	/** Svelte action that lifts a node into the host's overlay layer. */
	overlayPortal(node: HTMLElement): { destroy(): void } | void;
	createEyeToggle(): {
		srcFor(on: boolean, key?: string): string;
		isSettledOff(on: boolean, key?: string): boolean;
		play(on: boolean, key?: string): void;
		destroy(): void;
	};
	/** Blinks ONCE then acts: a button, not a switch. */
	createEyeBlink(): {
		srcFor(key?: string): string;
		blinkThen(action: () => void, key?: string): Promise<void>;
		destroy(): void;
	};
	/** Predecodes every frame so a blink does not flash on first play; not interchangeable with MaskedIcon. */
	MaskedFrameIcon: Component<Record<string, unknown>>;
	eyeAllFrames: string[];
}

export interface MapGpsPorts {
	isGranted(): Promise<boolean>;
	reportError(scope: string, err: unknown, extra?: Record<string, unknown>): void;
}

export interface MapScenePorts {
	assetFacts(dir: string): { startFrame: number; frameCount: number; fps: number };
	framePath(dir: string, frameNumber: number): string;
}

// Quality-704 mirrors: only the fields PlotMapPopoverV2 reads or writes.

export interface MapQ704Species {
	name: string;
	count: number | null;
}

/** Required fields match the host's PlotRow exactly, so a row built here is a legal host row. */
export interface MapQ704PlotRow {
	id: string;
	plotNo?: number;
	planted: number | null;
	plantableSpotsOverride: number | null;
	plantableSpots?: number | null;
	faults: string[];
	comment: string;
	species?: MapQ704Species[];
	gpsFeatureKey?: string;
	openLocode?: string;
	committed: boolean;
}

export interface MapQ704BlockHeader {
	name?: string;
	landKey: string;
	landName: string;
	treesPerHa: number | null;
	totalHa: number | null;
	mapKey?: string;
	speciesChoices?: string[];
}

export interface MapQ704PlotPinData {
	plotNo: number;
	displayNo: number;
	planted: number | null;
	spots: number | null;
	excess: number | null;
	faults: string[];
	comment: string;
}

/** The in-flight, memory-only map drop. */
export interface MapQ704PendingDrop {
	plotNo: number;
	rowKey: string;
	gridCode: string;
}

export interface MapQ704PlotEdit {
	planted?: number | null;
	plantableSpotsOverride?: number | null;
	plantableSpots?: number | null;
	faults?: string[];
	comment?: string;
	species?: MapQ704Species[] | undefined;
}

/** "missing" is a REFUSED write the caller must surface, never fold into "unchanged". */
export type MapQ704WriteOutcome = "updated" | "unchanged" | "missing";

export interface MapQ704DeckProps {
	block?: MapQ704BlockHeader & { speciesChoices: string[] };
	rows?: MapQ704PlotRow[];
	showHeader?: boolean;
	singlePlot?: boolean;
	onReward?: () => void;
	onFocusingChange?: (focusing: boolean) => void;
	autoRestoreMissed?: boolean;
	mapNumberFor?: (row: MapQ704PlotRow) => number;
}

/** The deck's `bind:this` surface. */
export interface MapQ704DeckExports {
	focusRow(rowId: string): void;
	openPlantedFor(rowId: string): void;
}

export interface MapQ704FaultChipProps {
	code: string;
	count?: number;
}

export interface MapQ704CelebrateHostProps {
	target: HTMLElement | null;
}

/** The host-supplied MapDrawControls' `bind:this` surface. */
export interface MapDrawControlsExports {
	importFile(file: File): void;
	requestMyLocation(): Promise<void>;
}

export interface MapQ704Ports {
	Quality704Deck: Component<MapQ704DeckProps, MapQ704DeckExports>;
	FaultChip: Component<MapQ704FaultChipProps>;
	CelebrateHost: Component<MapQ704CelebrateHostProps>;
	celebrate: { onInputComplete(): void };
	/** Svelte action: `<button use:atvShare>` arms the ATV ride on tap. */
	atvShare(
		node: HTMLElement,
		opts?: { exit?: "left" | "right" | "auto" },
	): { update?(next?: { exit?: "left" | "right" | "auto" }): void; destroy(): void } | void;
	loadInspection(): Promise<{ block: MapQ704BlockHeader; rows: MapQ704PlotRow[] } | null>;
	/** gpsFeatureKey → the per-map plot number the user sees. */
	activeMapNumbering(): Map<string, number>;
	plotByGpsKey(gpsFeatureKey: string): MapQ704PlotPinData | null;
	plotFullCodeByGpsKey(gpsFeatureKey: string): string;
	/** `rowId` is `q`-prefixed or the bare store key. */
	updateActivePlot(rowId: string, fields: MapQ704PlotEdit): MapQ704WriteOutcome;
	setActiveSpeciesChoices(choices: string[]): void;
	getPendingDrop(): MapQ704PendingDrop | null;
	pendingDropPinData(): MapQ704PlotPinData | null;
}

export interface MapHostPorts {
	store: MapHostStore;
	ui: MapUiPorts;
	gps: MapGpsPorts;
	scenes?: MapScenePorts;
	q704?: MapQ704Ports;
}
