// "Just now" / "2 minutes ago" labels for the game log. Minute granularity, so labels only need
// refreshing every few seconds.

export function relativeTime(diffMs: number): string {
  const sec = Math.max(0, diffMs) / 1000;
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** How often relative labels are refreshed. */
export const RELATIVE_TIME_REFRESH_MS = 10_000;
