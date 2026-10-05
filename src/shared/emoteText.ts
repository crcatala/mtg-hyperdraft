// A player's own emote line (the wheel's text, rewritten for this tab): cleaned the same way by the client before
// it's saved and sent, and by the room before it's relayed, so what other players see is always one tidy line.
// No content filter (smack talk among friends is the point) and no HTML escaping: React escapes text when it
// renders it, so pre-escaping here would only show "&lt;" literally. Pure, so it can be tested.

/** Longest custom emote line, in characters (code points), after cleaning. The large bubble wraps it fine. */
export const EMOTE_TEXT_MAX = 60;
/** Longest raw text the protocol accepts (UTF-16 units): room for any clean line, then the cleaner decides. */
export const EMOTE_TEXT_RAW_MAX = EMOTE_TEXT_MAX * 2;

/** Characters that show nothing or reorder what's around them: controls (but not whitespace, handled next),
 * format characters (zero-width spaces/joiners, bidi marks and overrides, BOM, soft hyphen, tags...) and lone
 * surrogates. A zero-width joiner between two emoji is kept, so 👨‍👩‍👧 stays one picture. */
const INVISIBLE = /(?![\t\n\v\f\r\u0085])\p{Cc}|(?<!\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]?)‍|‍(?!\p{Extended_Pictographic})|(?!‍)\p{Cf}|\p{Cs}/gu;
/** Any run of whitespace, line breaks and Unicode spaces (NBSP, ideographic space...) included. */
const SPACES = /[\s\u0085]+/gu;

/** How long a line is, as the limit counts it: in code points, so an emoji is one. */
export const emoteTextLength = (s: string): number => [...s].length;

/** Strips invisible characters and squeezes whitespace into single spaces, trimmed. */
export const tidyEmoteText = (s: string): string => s.replace(INVISIBLE, "").replace(SPACES, " ").trim();

/** A custom emote line made safe to show: tidied, or null when that leaves it empty or longer than EMOTE_TEXT_MAX. */
export function cleanEmoteText(s: string): string | null {
  const text = tidyEmoteText(s);
  return text && emoteTextLength(text) <= EMOTE_TEXT_MAX ? text : null;
}
