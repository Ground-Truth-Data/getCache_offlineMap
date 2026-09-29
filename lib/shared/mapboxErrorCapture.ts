// Attach at CONSTRUCTION time (onMapCreated), not onMapReady — a style that never finishes loading never fires onMapReady, so it would go unreported.

// The slice of a map this file needs: one error listener.
// Structural, not mapboxgl.Map | maplibregl.Map — that union fails to typecheck (on() is overloaded in both, TS can't reconcile the signatures).
type ErrorEmittingMap = {
	on(type: "error", listener: (e: unknown) => void): unknown;
};

export function attachMapErrorCapture(map: ErrorEmittingMap, page: string): void {
	map.on("error", (e) => {
		// Attaching an "error" listener suppresses mapbox's built-in console.error — re-log so console behavior stays the same.
		console.error(`[${page}] map error:`, (e as { error?: Error }).error ?? e);
	});
}
