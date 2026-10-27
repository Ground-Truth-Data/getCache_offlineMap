/** The narrow interface between the offline preview engine and whatever app hosts it. */

export interface HostPlace {
	/** [lng, lat]. A point has one; a line has many. */
	anchors: [number, number][];
	/** Bakes a satellite photo at its anchor. Pins only: the photo source bills per tile, and a shape's anchors would each take one. */
	photo: boolean;
	/** An import too big to fetch unasked: the planter saves one pin or the whole set, after seeing its size. Absent = fetched on its own. */
	set?: { key: string; name: string };
}

export interface HostPorts {
	/** Every place to keep offline, right now. */
	places(): HostPlace[];
	/** Has the host finished loading? ⚠️ Eviction depends on this — a cold-reload host that's still hydrating looks "empty" but is NOT "no places"; treating those the same nukes stored blobs. A host with nothing to hydrate should return true. */
	ready(): boolean;
	/** Register for "the list changed" — a PUSH, not a reactive read; must fire on every add/move/delete/import/restore, and once on register. ⚠️ Required, not a preference — an $effect reading host state across a module boundary silently failed to fire on a fresh pin drop. */
	onPlacesChanged(fn: () => void): () => void;
}
