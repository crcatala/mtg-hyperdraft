// Game-log sentences with styled spans (players, cards, actions, zones, numbers). Written as tagged
// templates so each sentence still reads as one line of English:
//
//   logText`${player(id, "Alice")} ${verb("tapped")} ${card("Llanowar Elves", cardId)}.`
//
// The result is the plain text plus marks pointing into it (see LogMark), which the client renders
// as coloured names, card links and so on.

import type { LogMark } from "./types";

export interface LogText {
  text: string;
  marks: LogMark[];
}

/** A piece of a log sentence: plain text, or text that is (or contains) marked spans. */
export type LogPiece = string | number | LogText;

type MarkTail = LogMark extends [number, number, ...infer Rest] ? Rest : never;

function append(into: LogText, piece: LogPiece) {
  if (typeof piece !== "object") {
    into.text += String(piece);
    return;
  }
  const at = into.text.length;
  for (const [start, end, ...tail] of piece.marks) into.marks.push([start + at, end + at, ...tail] as LogMark);
  into.text += piece.text;
}

export function logText(strings: TemplateStringsArray, ...pieces: LogPiece[]): LogText {
  const out: LogText = { text: "", marks: [] };
  strings.forEach((s, i) => {
    out.text += s;
    if (i < pieces.length) append(out, pieces[i]);
  });
  return out;
}

/** Joins pieces with a separator, e.g. a list of card names. */
export function joinLog(pieces: LogPiece[], sep: string): LogText {
  const out: LogText = { text: "", marks: [] };
  pieces.forEach((p, i) => {
    if (i > 0) out.text += sep;
    append(out, p);
  });
  return out;
}

function marked(text: string, ...tail: MarkTail): LogText {
  return { text, marks: text ? [[0, text.length, ...tail] as LogMark] : [] };
}

export const player = (id: string, name: string) => marked(name, "p", id);
export const verb = (text: string) => marked(text, "v");
export const zone = (text: string) => marked(text, "z");
export const num = (value: string | number, tone?: "good" | "bad") => (tone ? marked(String(value), "n", tone) : marked(String(value), "n"));

/** A card name. Leaves out what it doesn't have: JSON would turn a gap in the tuple into null. */
export function card(name: string, cardId?: string, face = 0): LogText {
  if (!cardId) return marked(name, "c");
  return face > 0 ? marked(name, "c", cardId, face) : marked(name, "c", cardId);
}

/** Splits a line into plain and marked runs, in order (marks are never nested or overlapping). */
export function logSegments(text: string, marks: LogMark[] = []): { text: string; mark?: LogMark }[] {
  const out: { text: string; mark?: LogMark }[] = [];
  let at = 0;
  for (const m of [...marks].sort((a, b) => a[0] - b[0])) {
    const [start, end] = m;
    // Ignore anything that doesn't fit the text (a malformed or stale entry): show it plain.
    if (start < at || end > text.length || end <= start) continue;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: text.slice(start, end), mark: m });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
