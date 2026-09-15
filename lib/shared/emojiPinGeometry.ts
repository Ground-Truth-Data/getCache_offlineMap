// The emoji pin's proportions — the plate is artwork, so a glyph laid on it
// only lands in the bowl at these exact numbers.
//
// Its own module, with NO imports, because the three renderers cannot share
// one: `icons.ts` reaches for `import.meta.glob` and .webp imports, so a plain
// `node` script cannot load it — and `tools/makeEmojiPins.mjs` is exactly that.
// Anything added here must stay importable by both Vite and bare Node.
//
// Everything is a FRACTION of the pin's width, never a pixel, so one number
// scales a 22px inbox glyph and a 300px baked tile identically.

/** Glyph size as a fraction of pin width.
 *  0.72 fills the bowl right up to the gold ring without the widest glyphs
 *  (❤️, 🤝, flags — wider than the round faces) sitting on top of it. Past
 *  ~0.75 those start to breach the gold. */
export const EMOJI_PIN_GLYPH_SCALE = 0.72;

/** The teardrop's tail, as a fraction of pin height. The glyph is centred in
 *  what remains above it — the round head — not in the whole plate. */
export const EMOJI_PIN_TAIL_FRACTION = 0.28;

/** The plate artwork is 300x420; every surface keeps that shape at any size. */
export const EMOJI_PIN_ASPECT_W = 30;
export const EMOJI_PIN_ASPECT_H = 40;

/** The tail as a CSS percentage. Rounded: 0.28 * 100 is 28.000000000000004 in
 *  binary floating point, and that lands verbatim in the DOM. */
export const EMOJI_PIN_TAIL_PCT = Number((EMOJI_PIN_TAIL_FRACTION * 100).toFixed(4));

/** `inset` for the glyph box: the plate minus the tail. */
export const EMOJI_PIN_HEAD_INSET = `0 0 ${EMOJI_PIN_TAIL_PCT}% 0`;
