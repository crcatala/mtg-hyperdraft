// The Treatomancer at the table: taking hold of its menu (one player at a time, everyone sees who), buying a
// treat, and playing the show the room sends back, the same on every screen (shared/treats.ts plans it from a
// seed). The machine rattles and fires, the treat lands and pops open, the companions race for it (some trip),
// the winner eats or hugs it with a line of its own, the rest sulk, and everyone trots home. While it plays,
// nobody can poke, carry or emote with a companion, or use the machine.
//
// The 3D parts (Treatomancer.tsx, TreatFlight.tsx, CompanionFigure.tsx) read treatState.ts every frame; this
// module only fires the beats: sounds, reactions, voices and bubbles.

import { BEATS, LAND_AT, LOSER_LINES, RACE_AT, treatDef, tripLine, tripTime, winLine, type TreatShowSpec } from "../../shared/treats";
import { serverNow, useStore } from "../store";
import { treatSound } from "../treatSounds";
import { cancelPet } from "./companionCarry";
import { closeEmoteWheel } from "./companionEmote";
import { playReaction, stopReaction } from "./companionPlayback";
import { say, voice } from "./companionTalk";
import { tableApi } from "./drag";
import { me } from "./tableUi";
import { showBusy, startShowState, useTreats, vendHolder } from "./treatState";

const timers = new Set<ReturnType<typeof setTimeout>>();
const at = (seconds: number, fn: () => void) => {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, Math.max(0, seconds * 1000));
  timers.add(t);
};

const nameOf = (id: string | null | undefined) => useStore.getState().view?.players.find((p) => p.id === id)?.name ?? "Someone";

/** Clicking the machine: asks the room for its menu (it may say someone else has it, or a show is on). */
export function openVend() {
  const s = useTreats.getState();
  if (s.open || s.pending) return;
  if (showBusy()) {
    treatSound("denied");
    useStore.getState().toast("The Treatomancer is busy. Wait for the treat to be gobbled!");
    return;
  }
  const holder = vendHolder();
  if (holder && holder !== me()) {
    treatSound("denied");
    useStore.getState().toast(`${nameOf(holder)} is browsing the Treatomancer.`);
    return;
  }
  useTreats.setState({ pending: true });
  useStore.getState().send({ t: "vend", open: true });
  // The room always answers (a vend or an error); if it somehow doesn't, stop waiting.
  at(4, () => useTreats.getState().pending && useTreats.setState({ pending: false }));
}

/** Closing the menu without buying: lets go of the machine for everyone. */
export function closeVend() {
  const s = useTreats.getState();
  if (!s.open && !s.pending) return;
  useTreats.setState({ open: false, pending: false, vend: s.vend?.by === me() ? null : s.vend });
  treatSound("close");
  useStore.getState().send({ t: "vend", open: false });
}

/** Buys a treat: the room takes the glimmers and sends everyone the show. */
export function buyTreat(id: string): boolean {
  const def = treatDef(id);
  const view = useStore.getState().view;
  const left = view?.table?.players[view.you]?.glimmers;
  if (!def || (left !== undefined && left < def.cost)) {
    treatSound("denied");
    return false;
  }
  treatSound("buy");
  useTreats.setState({ open: false });
  useStore.getState().send({ t: "treat", treat: id });
  return true;
}

/** The room says who holds the machine now (null: nobody). */
export function receiveVend(by: string | null, until?: number) {
  const s = useTreats.getState();
  const mine = by !== null && by === me();
  if (mine && s.pending) treatSound("open");
  useTreats.setState({
    vend: by ? { by, until: until ?? serverNow() + 60_000 } : null,
    // Ours: the menu opens (if we asked). Anyone else's, or nobody's: ours closes.
    open: mine ? s.open || s.pending : false,
    pending: false,
  });
}

/** A room view arrived: it carries who holds the machine, which a screen that just joined wouldn't know. */
export function syncVendFromView() {
  const view = useStore.getState().view;
  if (!view || useTreats.getState().pending) return;
  const v = view.vend ?? null;
  const cur = useTreats.getState().vend;
  if (v?.by === cur?.by && v?.until === cur?.until) return;
  useTreats.setState({ vend: v, open: useTreats.getState().open && v?.by === view.you });
}

/** A treat was bought: play the show. */
export function receiveTreat(spec: TreatShowSpec) {
  // Anything in hand ends: a carried companion goes back, the emote wheel closes.
  cancelPet();
  closeEmoteWheel();
  clearShowTimers();
  const show = startShowState(spec);
  const { plan } = show;
  const def = treatDef(spec.treat);
  const companionOf = (id: string) => spec.racers.find((r) => r.id === id)?.companion;
  const variantOf = (id: string) => useStore.getState().view?.players.find((p) => p.id === id)?.companionVariant ?? 0;
  const panAt = (x: number, y: number) => tableApi.screenPan(x, y) * 0.8;
  const panOf = (id: string) => {
    const run = plan.runs.find((r) => r.id === id);
    return run ? panAt(run.stop.x, run.stop.y) : 0;
  };
  const talk = (id: string, slot: string, gain = 1) => {
    const c = companionOf(id);
    if (c) voice(c, slot, { variant: variantOf(id), pan: panOf(id), gain });
  };

  // The machine winds up...
  treatSound("rumble");
  at(0.15, () => treatSound("drumroll", { gain: 0.9 }));
  // ...and fires: every companion looks up.
  at(BEATS.launch, () => {
    treatSound("launch");
    for (const r of plan.runs) playReaction(r.id, "alert");
  });
  at(LAND_AT, () => treatSound("land", { pan: panAt(spec.at.x, spec.at.y) }));
  if (plan.runs.length) at(RACE_AT, () => treatSound("scamper"));

  for (const run of plan.runs) {
    const id = run.id;
    at(run.go, () => playReaction(id, "dash"));
    const trip = tripTime(run);
    if (trip !== null && run.trip && trip < plan.takenAt + 0.5) {
      at(trip, () => {
        playReaction(id, "trip");
        treatSound("trip", { pan: panOf(id) });
        talk(id, "emote3", 0.9);
        // A trip right as someone else takes it would talk over the winner: that one is a silent face-plant.
        if (id === plan.winner || trip < plan.takenAt - 0.4) say(id, tripLine(run.companion, run.trip!.line), "small");
      });
      at(trip + run.trip.dur, () => playReaction(id, "dash"));
    }
    if (id === plan.winner) {
      at(plan.takenAt, () => {
        playReaction(id, def?.kind === "keep" ? "hug" : "feast");
        treatSound(def?.kind === "keep" ? "win" : "chomp", { pan: panOf(id) });
        talk(id, "emote1");
        if (def) say(id, winLine(run.companion, plan.winLine, def), "large", { icon: "treat", color: def.color });
      });
      if (def?.kind === "eat") at(plan.takenAt + 0.9, () => treatSound("win", { gain: 0.8 }));
    } else {
      // Those who got to their spot just stand there; the rest give up when it's taken.
      at(Math.min(run.arrive, plan.takenAt + 0.5), () => stopReaction(id));
      const rank = plan.runs.filter((r) => r.id !== plan.winner).indexOf(run);
      at(plan.takenAt + 0.7 + rank * 0.3, () => playReaction(id, "pout"));
      // Their grumbles wait for the winner's moment to pass (they mutter them on the way home).
      if (run.sulk !== undefined) {
        at(plan.takenAt + 2.5 + rank * 0.45, () => {
          talk(id, "poke5", 0.6);
          say(id, LOSER_LINES[run.sulk!], "small");
        });
      }
    }
  }

  // Back to their spots, then it's over.
  at(plan.homeAt, () => {
    if (plan.runs.length) treatSound("scamper", { gain: 0.5, rate: 1.15 });
    for (const r of plan.runs) playReaction(r.id, "dash");
  });
  at(plan.endAt, () => {
    for (const r of plan.runs) stopReaction(r.id);
    useTreats.setState({ show: null });
  });
}

function clearShowTimers() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
}

/** Leaving the table: stop any show, forget the machine's holder and close the menu. */
export function resetTreats() {
  clearShowTimers();
  useTreats.setState({ vend: null, open: false, pending: false, show: null });
}
