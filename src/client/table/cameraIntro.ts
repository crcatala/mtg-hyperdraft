// The table's opening shot (CameraRig): how far along it is at a given moment. It holds still while a pointer is
// down, so a card grabbed during the glide is picked, dragged and dropped under one unmoving camera (drag offsets
// and the drop spot are both worked out from the camera's pose), then carries on from where it paused.

export interface IntroClock {
  /** When the shot started (performance.now), or -1 until its first frame. */
  start: number;
  /** When it was paused (a pointer went down), if it is. */
  pausedAt?: number;
}

/** 0..1 through a shot lasting `ms`, as of `now`. A paused shot reports where it stopped. */
export function introProgress(c: IntroClock, now: number, ms: number): number {
  if (c.start < 0) return 0;
  const at = c.pausedAt ?? now;
  return Math.min(1, Math.max(0, (at - c.start) / ms));
}

export function pauseIntro(c: IntroClock, now: number) {
  if (c.pausedAt === undefined && c.start >= 0) c.pausedAt = now;
}

/** Carries on from where it paused: the time spent paused doesn't count. */
export function resumeIntro(c: IntroClock, now: number) {
  if (c.pausedAt === undefined) return;
  c.start += now - c.pausedAt;
  c.pausedAt = undefined;
}
