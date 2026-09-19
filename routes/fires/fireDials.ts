/**
 * fireDials.ts — THE dials for how busy the fire layer looks. Edit and reload.
 *
 * Both maps read these; there is no second copy to keep in step.
 *
 * The rule they serve: a quiet region should show its few fires individually,
 * so the layer is visibly a feature; a region that is covered in them should
 * stay calm, because someone standing in it only cares about the ones near
 * them. Volume decides, not size — a fire is never hidden for being small.
 *
 * ⛔ Neither dial may remove a fire. Clustering GROUPS; zooming in always
 * takes a group apart. The 500 km wall in fireRelevance.ts stays the only
 * thing that drops a detection.
 */

/**
 * DIAL 1 — how hard fires clump, in screen pixels.
 *
 * The volume dial. Bigger sweeps more fires into one mark, so a busy region
 * calms down while a quiet one is untouched: three fires 200 km apart never
 * fall inside the same radius whatever this says. That is why this handles
 * both Ottawa and Kinshasa without a separate density setting.
 *
 * 50 clumps only what overlaps · 80 noticeably calmer · 120 a dense region
 * becomes a handful of marks.
 */
export const FIRE_CLUSTER_RADIUS = 120;

/**
 * DIAL 2 — the zoom at which clumping stops and every fire draws itself.
 *
 * Raise it and clumping persists as you zoom in; lower it and detail arrives
 * sooner. This is the one that makes a dense region explode into hundreds of
 * flames at a certain zoom: above this number nothing is grouped any more.
 *
 * Independent of DIAL 3: the hull has its own unclustered source, so the two
 * marks may overlap. A counted bubble sitting inside a hull is them agreeing.
 */
export const FIRE_CLUSTER_MAX_ZOOM = 11;

/**
 * DIAL 3 — the zoom the red hull around a group of fires appears at.
 *
 * The hull is GEOGRAPHY: built from raw detection coordinates in a source of
 * its own, never from what is on screen, so it exists at every zoom and this
 * dial only decides when to reveal it. Lower shows it from further out.
 *
 * It answers "is the fire between me and where I am going", which is asked
 * looking at a province — so it is set out at regional scale, well below the
 * zoom where individual flames take over the telling.
 *
 * 8 a province · 11 a district · 13 one fire
 *
 * ⛔ THIS IS A TREE-PLANTING APP. The outline is the most "fire app" looking
 * mark on the map, so it earns the strictest gate here.
 *
 * ⚠️ HISTORY, AND THE THING TO WATCH: 11 was tried once and pulled back to 13,
 * because a screen of scattered red polygons over ground nobody is standing on
 * read as pollution. Set to 8 deliberately — the hull answers "is the fire
 * between me and where I am going", which is a regional question — but if it
 * ever reads as clutter again, that is this number, and the fix is to raise it.
 */
export const FIRE_OUTLINE_MIN_ZOOM = 8;
