// When a room Durable Object wakes up just to look for dead sockets (see worker/roomObject.ts).

/**
 * How often to look for stale sockets while the room is in use. Each sweep is an alarm that wakes
 * the room (pings alone don't), so keep it infrequent: a dead socket is noticed within 90-150 s.
 */
export const PRESENCE_SWEEP_MS = 60 * 1000;
/**
 * Sweeps stop once nobody has joined or sent a message for this long, so a tab left open
 * overnight lets the room hibernate instead of waking it every minute. The next join or message
 * sweeps at once and starts them again. Well above the longest turn timer (2 min), so it rarely
 * trips during a game.
 */
export const QUIET_AFTER_MS = 10 * 60 * 1000;

/**
 * When the next presence sweep is due, or null if the room shouldn't wake just for presence.
 * `current` is the alarm already set: one due soon enough is kept, so frequent reschedules don't
 * keep pushing the sweep back. `lastActivity` is the latest join or message from a live socket.
 */
export function presenceSweepAt(current: number | null, now: number, liveSockets: number, lastActivity: number): number | null {
  if (liveSockets === 0 || now - lastActivity >= QUIET_AFTER_MS) return null;
  return current !== null && current > now && current <= now + PRESENCE_SWEEP_MS ? current : now + PRESENCE_SWEEP_MS;
}
