// Poking companions: tap anyone's companion and it reacts (a voice sound, a motion, a line in a bubble), one
// step further up the poke ladder each time (pokeLadder.ts). Shaped like a table ping (pingAt/showPing in
// tableUi.ts): the tapper sees it at once, then the room relays it to everyone else, who show the same step.
// Nothing is stored anywhere, and solo play simply has nobody to relay to.

import { pokeLine, pokeSound, POKE_STEPS } from "../../shared/companionKit";
import { companionSpot } from "../../shared/tableLayout";
import { useStore } from "../store";
import { bodyStyle, reactionFor } from "./companionReactions";
import { reactionSeconds } from "./companionMotion";
import { playReaction } from "./companionPlayback";
import { say, voice } from "./companionTalk";
import { tableApi } from "./drag";
import { newLadder, observePoke, tapLadder } from "./pokeLadder";
import { table } from "./tableUi";

const ladder = newLadder();
/** The sulk that follows a finale, per companion (cancelled by a newer poke). */
const sulks = new Map<string, ReturnType<typeof setTimeout>>();

/** This player taps `target`'s companion. Returns false when the tap is ignored (it's sulking, or too soon). */
export function pokeCompanion(target: string): boolean {
  const step = tapLadder(ladder, target, performance.now());
  if (step === null) return false;
  showPoke(target, step);
  useStore.getState().send({ t: "poke", target, step });
  return true;
}

/** Someone else poked `target`'s companion: show the same step, and keep this player's ladder in step with it. */
export function receivePoke(target: string, step: number) {
  observePoke(ladder, target, step, performance.now());
  showPoke(target, step);
}

/** The poke itself, as everyone sees it: the companion's voice for that step, its reaction and its line. */
function showPoke(target: string, step: number) {
  const t = table();
  const seat = t?.seats.indexOf(target) ?? -1;
  const player = useStore.getState().view?.players.find((p) => p.id === target);
  const companion = player?.companion;
  if (!t || seat < 0 || !companion) return;
  const slot = pokeSound(step);
  const at = companionSpot(seat, t.seats.length);
  playReaction(target, slot);
  voice(companion, slot, { variant: player.companionVariant ?? 0, pan: tableApi.screenPan(at.x, at.y) * 0.8 });
  say(target, pokeLine(companion, step), "small");
  // After the finale it sulks (the ladder ignores taps meanwhile, then starts over).
  clearTimeout(sulks.get(target));
  sulks.delete(target);
  if (step === POKE_STEPS - 1) {
    const finale = reactionSeconds(reactionFor(companion, slot)!, bodyStyle(companion));
    sulks.set(
      target,
      setTimeout(() => {
        sulks.delete(target);
        playReaction(target, "sulk");
      }, finale * 1000),
    );
  }
}
