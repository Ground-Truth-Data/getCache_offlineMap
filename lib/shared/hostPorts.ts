/** The narrow interface between the offline preview engine and whatever app hosts it. */

export interface HostPlace {
	/** [lng, lat]. A point has one; a line has many. */
	anchors: [number, number][];
	/** Beside each anchor, the outer rings of the pieces its blob photographs; absent or null bakes no photo. Blocks and
	 * pieces under the photo cap only: the photo source bills per tile. */
	rings?: ([number, number][][] | null)[];
}

export interface HostPorts {
	/** Every place to keep offline, right now. */
	places(): HostPlace[];
	/** Has the host finished loading? ⚠️ Eviction depends on this — a cold-reload host that's still hydrating looks "empty" but is NOT "no places"; treating those the same nukes stored blobs. A host with nothing to hydrate should return true. */
	ready(): boolean;
	/** Register for "the list changed" — a PUSH, not a reactive read; must fire on every add/move/delete/import/restore, and once on register. ⚠️ Required, not a preference — an $effect reading host state across a module boundary silently failed to fire on a fresh pin drop. */
	onPlacesChanged(fn: () => void): () => void;
}
