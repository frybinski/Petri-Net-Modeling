/**
 * Emoji as a free vocabulary of symbols (N4). A symbol is exactly one grapheme cluster that is a
 * pictograph (with a variation selector, a skin tone or a ZWJ sequence), a flag or a keycap.
 */

/** The fonts an emoji is drawn with, in the order of the platforms, ending in a generic family. */
export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
const KEYCAP = /^[0-9#*]️?⃣$/u;
// A flag drawn from tag characters (England, Scotland): a black flag followed by tags.
const TAG_FLAG = /^\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}$/u;

let segmenter: Intl.Segmenter | null | undefined;

/** The grapheme clusters of a text (a code point at a time where the runtime has no segmenter). */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
  }
  if (segmenter === null) return Array.from(text);
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/**
 * Why a text is not a single emoji; `null` if it is one. The message is for the author of the
 * view and for the language model, so it says what is expected.
 */
export function emojiProblem(value: string): string | null {
  const parts = graphemes(value);
  if (parts.length === 0) return 'The emoji is empty; write exactly one emoji such as "🦄"';
  if (parts.length > 1) {
    return `"${value}" is ${parts.length} characters; write exactly one emoji such as "🦄"`;
  }
  const only = parts[0]!;
  if (PICTOGRAPH.test(only) || FLAG.test(only) || KEYCAP.test(only) || TAG_FLAG.test(only)) {
    return null;
  }
  return `"${value}" is not an emoji; write exactly one emoji such as "🦄", not a letter or a digit`;
}

/** True if the text is exactly one emoji. */
export function isEmoji(value: string): boolean {
  return emojiProblem(value) === null;
}
