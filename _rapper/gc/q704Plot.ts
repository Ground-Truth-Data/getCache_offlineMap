// FS 704 plot arithmetic: the phone records the inputs, the dashboard re-derives from the same file.

// TODO: the booklet recommends a 5.64 m plot at ≤800 sph; already parameterised on `radius`.
export type PlotRadius = 3.99;
export const PLOT_RADIUS: PlotRadius = 3.99;

/** The target density (stems/ha) when a block names none. */
export const DEFAULT_DENSITY = 1600;

export function plotArea(radius: PlotRadius): number {
	return Math.PI * radius * radius;
}

export function plotMultiplier(radius: PlotRadius): number {
	return 10000 / plotArea(radius);
}

export function maxSpots(density: number, radius: PlotRadius): number {
	return Math.round((density * plotArea(radius)) / 10000);
}

export type PlotInputs = {
	planted: number | null;
	plantableSpotsOverride: number | null; // override down only
	// M frozen when the count was recorded; null = live-derive from the header's current M.
	plantableSpots?: number | null;
	faults: string[];
};

export type PlotDerived = {
	spots: number;
	excess: number;
	unsat: number;
	satisfactory: number;
	valid: boolean;
};

// A row's own frozen plantableSpots always beats M.
export function derivePlot(row: PlotInputs, M: number): PlotDerived {
	const planted = row.planted ?? 0;
	const cap = row.plantableSpots ?? M;
	const spots = row.plantableSpotsOverride ?? cap;
	const excess = Math.max(0, planted - spots);
	const unsat = row.faults.length;
	const satisfactory = planted - excess - unsat;
	const valid =
		satisfactory >= 0 &&
		spots >= 0 &&
		spots <= cap &&
		satisfactory + unsat + excess === planted;
	return { spots, excess, unsat, satisfactory, valid };
}
