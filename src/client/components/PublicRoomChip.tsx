// Public rooms close on their own: a countdown chip for the top bars, and heads-up toasts as the
// end nears. Both render nothing in invite rooms and solo mode.

import { useEffect, useRef, useState } from "react";
import { serverNow, useStore } from "../store";
import { clockTime, dueWarning, EXPIRY_WARNINGS_MIN, timeLeft } from "../expiry";
import { durationLabel, PUBLIC_LIMITS } from "../../shared/publicRooms";
import { Icon } from "./Icon";

/** Server time, refreshed every `periodMs` while `active`. */
function useServerNow(active: boolean, periodMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), periodMs);
    return () => clearInterval(id);
  }, [active, periodMs]);
  return now;
}

export function PublicRoomChip() {
  const expiresAt = useStore((s) => s.view?.expiresAt ?? null);
  const now = useServerNow(expiresAt !== null, 10_000);
  if (expiresAt === null) return null;
  const left = expiresAt - now;
  const tone = left <= 10 * 60_000 ? " bad" : left <= 30 * 60_000 ? " warn" : "";
  return (
    <span
      className={`pill public-chip${tone}`}
      title={`Public room: closes at ${clockTime(expiresAt)}, or sooner if nobody's in it for ${durationLabel(PUBLIC_LIMITS.idleMs)}. Anyone with the link can join.`}
    >
      <Icon name="timer" /> Public · {timeLeft(left)} left
    </span>
  );
}

/** Toasts "closes in N minutes" at each of EXPIRY_WARNINGS_MIN, once per room visit. */
export function useExpiryWarnings() {
  const expiresAt = useStore((s) => s.view?.expiresAt ?? null);
  const toast = useStore((s) => s.toast);
  const now = useServerNow(expiresAt !== null, 5_000);
  const shown = useRef(new Set<number>());

  useEffect(() => {
    if (expiresAt === null) return;
    const left = expiresAt - now;
    const due = dueWarning(left, shown.current);
    if (due === null) return;
    for (const m of EXPIRY_WARNINGS_MIN) if (m >= due) shown.current.add(m);
    const minutes = Math.max(1, Math.ceil(left / 60_000));
    toast(`This public room closes in ${minutes} minute${minutes === 1 ? "" : "s"} (at ${clockTime(expiresAt)}).`, minutes <= 10 ? "error" : "info");
  }, [expiresAt, now, toast]);
}
