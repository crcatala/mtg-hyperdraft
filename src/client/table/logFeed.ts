// Bookkeeping for the game log panel. Log entries have no ids and the server keeps only the latest
// 200, so neither indexes nor the length identify what's new.

import type { LogEntry } from "../../shared/types";

const same = (a: LogEntry, b: LogEntry) => a.at === b.at && a.playerId === b.playerId && a.text === b.text;

/**
 * How many entries arrived after `prevNewest` (the newest entry seen last time). The first look
 * counts nothing as new; if `prevNewest` has already been trimmed away, everything is new.
 */
export function countNewEntries(prevNewest: LogEntry | null, log: LogEntry[]): number {
  if (!prevNewest) return 0;
  for (let i = log.length - 1; i >= 0; i--) if (same(log[i], prevNewest)) return log.length - 1 - i;
  return log.length;
}

/** Stable React keys: an entry keeps its key while older entries are trimmed from the front. */
export function logKeys(log: LogEntry[]): string[] {
  const seen = new Map<string, number>();
  return log.map((e) => {
    const base = `${e.at}|${e.playerId}|${e.text}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}
