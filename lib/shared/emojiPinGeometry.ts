// The plate is artwork: a glyph lands in the bowl only at these numbers, all
// FRACTIONS of pin width. No imports — tools/makeEmojiPins.mjs loads this from
// bare Node, so anything added must stay importable there too.

/** Past ~0.75 the widest glyphs (❤️, 🤝, flags) breach the gold ring. */
export const EMOJI_PIN_GLYPH_SCALE = 0.72;

/** Fraction of pin height; the glyph centres in the head above it. */
export const EMOJI_PIN_TAIL_FRACTION = 0.28;

/** The plate artwork is 300x420; every surface keeps that shape at any size. */
export const EMOJI_PIN_ASPECT_W = 30;
export const EMOJI_PIN_ASPECT_H = 40;

/** Rounded: 0.28 * 100 is 28.000000000000004, which lands verbatim in the DOM. */
export const EMOJI_PIN_TAIL_PCT = Number((EMOJI_PIN_TAIL_FRACTION * 100).toFixed(4));

export const EMOJI_PIN_HEAD_INSET = `0 0 ${EMOJI_PIN_TAIL_PCT}% 0`;
