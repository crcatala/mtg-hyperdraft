// The Treatomancer's client state, read every frame by the 3D scene (the machine, the flying treat, the racing
// companions) and by the HUD (its menu, the "browsing" tag). Kept apart from treatShow.ts, which plays the show,
// so the companion modules can ask "is a show on?" without importing the whole show.

import { create } from "zustand";
import { planShow, runPose, type RunPose, type ShowPlan, type TreatShowSpec } from "../../shared/treats";
import { serverNow, useStore } from "../store";

export interface LiveShow {
  spec: TreatShowSpec;
  plan: ShowPlan;
  /** performance.now() when it started on this screen. */
  start: number;
}

export interface TreatState {
  /** Who is browsing the machine (server time the hold ends), as last heard. */
  vend: { by: string; until: number } | null;
  /** This player's menu is open. */
  open: boolean;
  /** This player asked for the machine and is waiting to hear back. */
  pending: boolean;
  /** The show playing now, if any. */
  show: LiveShow | null;
}

export const useTreats = create<TreatState>(() => ({ vend: null, open: false, pending: false, show: null }));

export function startShowState(spec: TreatShowSpec): LiveShow {
  const show = { spec, plan: planShow(spec), start: performance.now() };
  useTreats.setState({ show, vend: null, open: false, pending: false });
  return show;
}

/** Seconds into the show playing now, or null. */
export function showTime(now = performance.now()): number | null {
  const s = useTreats.getState().show;
  return s ? (now - s.start) / 1000 : null;
}

/**
 * Whether the companions (and the machine) are off limits: a show is playing here, or the room says one is (a
 * screen that joined mid-show, or missed the start).
 */
export function showBusy(): boolean {
  if (useTreats.getState().show) return true;
  const until = useStore.getState().view?.showUntil;
  return !!until && until > serverNow();
}

/** Who holds the machine right now, if the hold hasn't run out. */
export function vendHolder(): string | null {
  const v = useTreats.getState().vend;
  return v && v.until > serverNow() ? v.by : null;
}

/** Where a racing companion is this frame, and what it's doing; undefined when it isn't in a show. */
export function racePose(playerId: string): RunPose | undefined {
  const s = useTreats.getState().show;
  if (!s) return undefined;
  const run = s.plan.runs.find((r) => r.id === playerId);
  return run ? runPose(run, s.plan, (performance.now() - s.start) / 1000) : undefined;
}

/** Where the machine's chute is (world coordinates; the machine writes it every frame): where treats fly from. */
export const machineMouth = { x: 0, y: 6, z: 0 };
/** The machine's top, on screen (viewport px), for the "browsing" tag; `on` is false when it's out of view. */
export const machineAnchor = { x: 0, y: 0, on: false };
