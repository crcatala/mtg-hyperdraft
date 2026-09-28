// Countdown labels and warnings for public rooms, which close on their own. Pure, so tests can
// drive it.

/** Minutes before closing at which everyone in the room gets a heads-up toast. */
export const EXPIRY_WARNINGS_MIN = [30, 10, 1];

/** "4h 12m", "6h", "12m", "under a minute". Minutes round up, like the warning toasts. */
export function timeLeft(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const min = Math.ceil(ms / 60_000);
  const h = Math.floor(min / 60);
  if (h === 0) return `${min}m`;
  return min % 60 === 0 ? `${h}h` : `${h}h ${min % 60}m`;
}

/**
 * The warning to show now, given the time left and the warnings already shown: the tightest
 * threshold reached that hasn't been shown. Joining with 5 minutes left shows one warning, not three.
 * The caller marks it and every looser threshold as shown.
 */
export function dueWarning(leftMs: number, shown: ReadonlySet<number>): number | null {
  const reached = EXPIRY_WARNINGS_MIN.filter((m) => leftMs <= m * 60_000 && !shown.has(m));
  return reached.length > 0 ? Math.min(...reached) : null;
}

/** "9:41 PM" in the player's own locale and time zone. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
