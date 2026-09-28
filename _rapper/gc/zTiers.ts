// The teaching hands' place in the z ladder: above every app surface, below
// the modal popovers. Never hand-type a z for a hand; never fix a buried hand
// by out-bidding a sibling. Ladder: 9999 sheets · 10400 sonner (mobile.css)
// · 10500 hands + share quad · 10600 modal scrims · 10610 field menus.

export const Z_HANDS = 10500;

/** Full-scrim modal surfaces eclipse even the hands. Scrim at this value, card at +1. */
export const Z_OVER_HANDS = Z_HANDS + 100;

/** A dropdown owned by a field inside a popover: a sibling of the opaque card, so it must outrank it. */
export const Z_FIELD_MENU = Z_OVER_HANDS + 10;
