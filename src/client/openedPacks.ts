// Packs this browser tab has already watched being opened, so reconnects don't replay the reveal.
// Pack ids are only unique within a room (every room starts counting from scratch), so entries
// are keyed by room code; solo games all share one code and are forgotten when a new one starts.

const KEY = "hyperdraft:opened";

const opened = new Set<string>(
  (() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  })(),
);

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...opened].slice(-50)));
  } catch {
    /* storage unavailable — this tab just forgets sooner */
  }
}

export function hasOpened(room: string, packId: string): boolean {
  return opened.has(`${room}:${packId}`);
}

export function markOpened(room: string, packId: string) {
  opened.add(`${room}:${packId}`);
  save();
}

/** Forgets every pack of a room (a new solo game reuses the same code and pack ids). */
export function forgetOpenedPacks(room: string) {
  for (const k of opened) if (k.startsWith(`${room}:`)) opened.delete(k);
  save();
}
