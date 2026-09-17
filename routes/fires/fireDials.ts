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
 * ⚠️ MUST stay below OUTLINE_MIN_ZOOM (13) — a counted blob and a fire's
 * outline on screen together read as a disaster app. fireDials.test.ts holds
 * the line.
 */
export const FIRE_CLUSTER_MAX_ZOOM = 12;
