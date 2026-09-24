/** Is-it-urban per ~375 m cell, classified once and kept in memory; it rebuilds in milliseconds. */

import { cellKey } from "./masks/staticHeatSources";

const verdicts = new Map<string, boolean>();

/** Cells per synchronous slice; ~17.8 ms per 1,000 lookups, so 400 fits a frame on a slow phone. */
export const CLASSIFY_SLICE = 400;

/** null if not yet classified */
export function peekUrbanVerdict(lng: number, lat: number): boolean | null {
	const v = verdicts.get(cellKey(lng, lat));
	return v === undefined ? null : v;
}

export function setUrbanVerdict(lng: number, lat: number, urban: boolean): void {
	verdicts.set(cellKey(lng, lat), urban);
}

/**
 * Classifies unseen coordinates in frame-sized slices; true only when it learned something.
 * Never await this before a first paint: the layer draws with what it knows and refines after.
 */
export async function classifyPending(
	coords: readonly (readonly [number, number])[],
	isUrbanFn: (lng: number, lat: number) => boolean,
	sliceSize: number = CLASSIFY_SLICE,
): Promise<boolean> {
	const todo = new Map<string, readonly [number, number]>();
	for (const c of coords) {
		const key = cellKey(c[0], c[1]);
		if (!verdicts.has(key) && !todo.has(key)) todo.set(key, c);
	}
	if (todo.size === 0) return false;

	let i = 0;
	for (const [key, c] of todo) {
		verdicts.set(key, isUrbanFn(c[0], c[1]));
		if (++i % sliceSize === 0) {
			// A macrotask: microtasks run before paint and would not release the frame.
			await new Promise((r) => setTimeout(r, 0));
		}
	}
	return true;
}

export function classifiedCount(): number {
	return verdicts.size;
}

export function __resetClassifyCacheForTest(): void {
	verdicts.clear();
}
