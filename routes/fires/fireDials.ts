/**
 * The dials for how busy the fire layer looks; both maps read these.
 * Neither dial may remove a fire: clustering groups, zooming in takes a group apart.
 * The 500 km wall in fireRelevance.ts is the only thing that drops a detection.
 */

/** Screen pixels. 50 clumps only what overlaps · 80 noticeably calmer · 120 a dense region becomes a handful of marks. */
export const FIRE_CLUSTER_RADIUS = 120;

/** Above this zoom nothing is grouped. Independent of the hull, which has its own unclustered source. */
export const FIRE_CLUSTER_MAX_ZOOM = 11;

/** The zoom the red hull appears at: 8 a province · 11 a district · 13 one fire. If it ever reads as clutter, raise this. */
export const FIRE_OUTLINE_MIN_ZOOM = 8;
