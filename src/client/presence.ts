// Who dropped out or came back, for "Bob left" / "Bob is back" toasts.

import type { Player } from "../shared/types";

/** Players whose connection changed between two views (bots and yourself excluded). */
export function presenceChanges(prev: Player[], next: Player[], me: string): { left: Player[]; back: Player[] } {
  const was = new Map(prev.map((p) => [p.id, p.connected]));
  const left: Player[] = [];
  const back: Player[] = [];
  for (const p of next) {
    if (p.isBot || p.id === me || !was.has(p.id)) continue;
    const before = was.get(p.id);
    if (before && !p.connected) left.push(p);
    else if (!before && p.connected) back.push(p);
  }
  return { left, back };
}
