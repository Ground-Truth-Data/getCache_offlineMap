// ════════════════════════════════════════════════════════════════════════════
// Z TIERS — the teaching hands' place in the app's z-index ladder.
//
// THE RULE: the cycle's teaching animations (pointing hand, swipe demo,
// commit/bag-out hand) render ON TOP of every app surface. A hand that paints
// under a stats band / popover glass / section border looks broken and reads as
// "the animation never fired" — that class of bug cost days. So the hands get
// ONE named tier, imported everywhere a hand mounts. Never hand-type a z for a
// hand again; never "fix" a buried hand by out-bidding a sibling.
//
// The surveyed ladder this slots into (2026-07, grep `z-index` under mobile):
//   0–200      page content, rows, plaques, scrims, in-card spotlights
//   9000       ImportProgress
//   9990–10001 intro tour (scrim / buttons / fingers)
//   9999       FeatureDetail sheet, layout drag overlay
//   10400      sonner toaster (rapper/gc/mobile.css pins it; sonner ships 999999999)
//   10500      ← Z_HANDS (this file) — above ALL of the above, by design;
//              the share quad (atvShare.ts) rides at this tier too
//   10600      ← Z_OVER_HANDS (this file) — modal receipts that eclipse hands
//   10610      ← Z_FIELD_MENU (this file) — a dropdown owned by a field inside
//              one of those popovers
//   999999     LiveReloadBadge (dev-only) — the only thing above everything
//
// Deliberate consequences (checked, not accidental): a hand outranks the intro
// tour and the FeatureDetail sheet. In practice the cycle suppresses hands
// while editors/overlays are open, so overlap is rare — but if a hand ever
// visibly fights one of those surfaces, THIS number is the one dial to turn.
// ════════════════════════════════════════════════════════════════════════════

/** The teaching-hands tier: pointing hand, swipe demo, commit hand. */
export const Z_HANDS = 10500;

/**
 * Full-scrim modal surfaces (the quality/density math popover, and EVERY
 * InputPopover — which is every drawer, prompt and TopShelf message): the user
 * either asked for this surface or is being told to stop and read it, so it
 * eclipses even the teaching hands — the insist arm dims under the scrim
 * instead of painting over the words. A hand pointing at something BEHIND a
 * popover must stay behind it. Scrim mounts at this value, card at +1.
 */
export const Z_OVER_HANDS = Z_HANDS + 100;

/**
 * A dropdown belonging to a field INSIDE a popover. It portals to the same host
 * as the popover card, so the two are siblings in one stacking context and a
 * menu below the card is invisible rather than merely dim — the card is opaque.
 * Every such menu must outrank the surface that owns its field.
 */
export const Z_FIELD_MENU = Z_OVER_HANDS + 10;
