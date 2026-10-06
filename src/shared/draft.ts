// Booster draft engine. Pure functions over DraftState (mutated in place; the room owns persistence).
//
// Each seat has a queue of packs. You pick from the head of your queue, then the pack moves to your
// neighbour's queue (left = seat + 1). A round ends when every pack of that round is empty.

import type { CardData, CardInstance, CardMap, DraftConfig, DraftMode, DraftState, Pack, RarityGroup } from "./types";
import { DEFAULT_CONFIG, DRAFT_PRESETS } from "./types";
import { pickScore, colorAffinity } from "./autopick";
import type { Rng } from "./rng";

export interface DraftEnv {
  config: DraftConfig;
  cards: CardMap;
  instances: Record<string, CardInstance>;
  rng: Rng;
  now: number;
  nextId: (prefix: string) => string;
}

export function cardsNeeded(seatCount: number, config: DraftConfig): number {
  return seatCount * config.packsPerPlayer * config.cardsPerPack;
}

export const RARITY_GROUPS: RarityGroup[] = ["rare", "uncommon", "common"];
const GROUP_NAMES: Record<RarityGroup, string> = { rare: "rares & mythics", uncommon: "uncommons", common: "commons" };

/** Which pack slot a card fills: mythics and specials share the rare slot. */
export function rarityGroup(card: CardData | undefined): RarityGroup {
  if (card?.rarity === "common" || !card) return "common";
  return card.rarity === "uncommon" ? "uncommon" : "rare";
}

export interface CardCount {
  copies: number;
  unique: number;
}
/** What a cube's pool can fill: total and per rarity group, counting copies and distinct cards. */
export interface PoolStats extends CardCount {
  byRarity: Record<RarityGroup, CardCount>;
}

export function poolStats(pool: string[], cards: CardMap): PoolStats {
  const byRarity = Object.fromEntries(RARITY_GROUPS.map((r) => [r, { copies: 0, unique: 0 }])) as Record<RarityGroup, CardCount>;
  const seen = new Set<string>();
  for (const id of pool) {
    const group = byRarity[rarityGroup(cards[id])];
    group.copies++;
    if (!seen.has(id)) {
      seen.add(id);
      group.unique++;
    }
  }
  return { copies: pool.length, unique: seen.size, byRarity };
}

/** Returns an error message when the pool can't fill the packs, else null. */
export function validatePool(stats: PoolStats, seatCount: number, config: DraftConfig): string | null {
  if (stats.copies === 0) return "Import a cube first.";
  if (config.picksPerTurn < 1) return "Picks per turn must be at least 1.";
  const packs = seatCount * config.packsPerPlayer;
  const slots = config.packSlots;
  if (!slots) {
    const needed = cardsNeeded(seatCount, config);
    if (!config.allowDuplicates && stats.copies < needed) {
      return `Need ${needed} cards for ${seatCount} seats × ${config.packsPerPlayer} packs × ${config.cardsPerPack} cards, but the cube has ${stats.copies}. Use smaller packs, fewer packs, or allow duplicates.`;
    }
    if (config.allowDuplicates && stats.unique < config.cardsPerPack) {
      return `Packs of ${config.cardsPerPack} need ${config.cardsPerPack} different cards, but the cube only has ${stats.unique}.`;
    }
    return null;
  }
  for (const r of RARITY_GROUPS) {
    const per = slots[r];
    if (per === 0) continue;
    const name = GROUP_NAMES[r];
    if (config.allowDuplicates) {
      const have = stats.byRarity[r].unique;
      if (have < per) return `Each pack needs ${per} different ${name}, but the cube only has ${have}. Lower the ${r} count.`;
    } else {
      const have = stats.byRarity[r].copies;
      if (have < per * packs) {
        return `${packs} packs × ${per} ${name} = ${per * packs} needed, but the cube has ${have}. Allow duplicates across packs, or lower the ${r} count.`;
      }
    }
  }
  return null;
}

/** Fills in settings added since a room was saved, and keeps cardsPerPack in step with the rarity slots. */
export function normalizeDraftConfig(config: DraftConfig): DraftConfig {
  const c = { ...DEFAULT_CONFIG.draft, ...config };
  if (c.packSlots) c.cardsPerPack = RARITY_GROUPS.reduce((sum, r) => sum + c.packSlots![r], 0);
  return c;
}

/** Whether the settings a draft style covers still match it (else the lobby shows it as modified). */
export function matchesPreset(config: DraftConfig, mode: DraftMode): boolean {
  const p = DRAFT_PRESETS[mode];
  const slotsMatch = p.packSlots && config.packSlots ? RARITY_GROUPS.every((r) => p.packSlots![r] === config.packSlots![r]) : p.packSlots === config.packSlots;
  return config.packsPerPlayer === p.packsPerPlayer && config.cardsPerPack === p.cardsPerPack && config.allowDuplicates === p.allowDuplicates && slotsMatch;
}

/** Rare slots favour rares 2:1 over mythics, like a real print sheet. */
function slotWeight(card: CardData | undefined): number {
  return card?.rarity === "mythic" ? 1 : 2;
}

/**
 * Takes `n` cards out of `source` at random (weighted), avoiding cards already in `pack` while it can.
 * Mutates `source`.
 */
function draw(source: string[], n: number, pack: string[], rng: Rng, weight: (id: string) => number): string[] {
  const out: string[] = [];
  for (let k = 0; k < n && source.length > 0; k++) {
    const taken = new Set([...pack, ...out]);
    let candidates = source.map((_, i) => i).filter((i) => !taken.has(source[i]));
    if (candidates.length === 0) candidates = source.map((_, i) => i); // Only copies left: better a repeat than a short pack.
    const total = candidates.reduce((sum, i) => sum + weight(source[i]), 0);
    let roll = rng() * total;
    let at = candidates[candidates.length - 1];
    for (const i of candidates) {
      roll -= weight(source[i]);
      if (roll < 0) {
        at = i;
        break;
      }
    }
    out.push(source[at]);
    source.splice(at, 1);
  }
  return out;
}

/**
 * The card ids of `count` packs. Without duplicates every pack draws from one shared pool, so a card
 * (copy) is dealt once; with duplicates every pack draws from the whole pool afresh. Either way a pack
 * never holds the same card twice while the pool can avoid it. With rarity slots, each slot draws from
 * its own rarity group, commons first and the rare last, like a real booster.
 */
export function dealPacks(count: number, pool: string[], env: Pick<DraftEnv, "config" | "cards" | "rng">): string[][] {
  const { config, cards, rng } = env;
  const slots = config.packSlots;
  const groups = slots
    ? (["common", "uncommon", "rare"] as const).map((r) => ({ ids: pool.filter((id) => rarityGroup(cards[id]) === r), n: slots[r], rare: r === "rare" }))
    : [{ ids: pool.slice(), n: config.cardsPerPack, rare: false }];
  const packs: string[][] = [];
  for (let p = 0; p < count; p++) {
    const pack: string[] = [];
    for (const g of groups) {
      const source = config.allowDuplicates ? g.ids.slice() : g.ids;
      pack.push(...draw(source, g.n, pack, rng, g.rare ? (id) => slotWeight(cards[id]) : () => 1));
    }
    packs.push(pack);
  }
  return packs;
}

export function passTarget(seat: number, round: number, seatCount: number, config: DraftConfig): number {
  const left = config.passPattern === "left" || round % 2 === 0;
  return (seat + (left ? 1 : -1) + seatCount) % seatCount;
}

export function createDraft(seats: string[], pool: string[], env: DraftEnv): DraftState {
  const { config, rng } = env;
  const dealt = dealPacks(seats.length * config.packsPerPlayer, pool, env);

  const unopened: Pack[][] = [];
  for (let round = 0; round < config.packsPerPlayer; round++) {
    const packs: Pack[] = [];
    for (let seat = 0; seat < seats.length; seat++) {
      const cardIds = dealt[round * seats.length + seat];
      const foilIndex = rng() < config.foilChance ? Math.floor(rng() * cardIds.length) : -1;
      const iids = cardIds.map((cardId, i) => {
        const iid = env.nextId("c");
        env.instances[iid] = { iid, cardId, ...(i === foilIndex ? { foil: true } : {}) };
        return iid;
      });
      packs.push({ id: env.nextId("p"), cards: iids, round, openedBy: seat, picksTaken: 0 });
    }
    unopened.push(packs);
  }

  const draft: DraftState = {
    round: 0,
    seats: seats.slice(),
    queues: seats.map(() => []),
    unopened,
    picks: Object.fromEntries(seats.map((id) => [id, []])),
    burned: [],
    log: [],
    done: false,
  };
  openRound(draft, 0, env);
  return draft;
}

function openRound(draft: DraftState, round: number, env: DraftEnv) {
  draft.round = round;
  draft.queues = draft.unopened[round].map((pack) => [pack]);
  draft.queues.forEach((q) => setDeadline(q[0], env));
}

export function pickTimerMs(pack: Pack, config: DraftConfig): number {
  if (config.pickTimerSec <= 0) return 0;
  if (config.timerStyle === "fixed") return config.pickTimerSec * 1000;
  // MTGO-style: time scales with cards left in the pack, never below 8 seconds.
  const fraction = pack.cards.length / config.cardsPerPack;
  return Math.max(8, Math.round(config.pickTimerSec * fraction)) * 1000;
}

function setDeadline(pack: Pack | undefined, env: DraftEnv) {
  if (!pack) return;
  const ms = pickTimerMs(pack, env.config);
  if (ms > 0) pack.deadline = env.now + ms;
  else delete pack.deadline;
}

export function seatOf(draft: DraftState, playerId: string): number {
  return draft.seats.indexOf(playerId);
}

/** How many cards must be picked / burned from this pack this turn. */
export function turnCounts(pack: Pack, config: DraftConfig): { picks: number; burns: number } {
  const picks = Math.min(config.picksPerTurn, pack.cards.length);
  const burns = Math.min(config.burnsPerTurn, pack.cards.length - picks);
  return { picks, burns };
}

export class DraftError extends Error {}

export function makePick(
  draft: DraftState,
  seat: number,
  packId: string,
  picks: string[],
  burns: string[],
  env: DraftEnv,
  auto = false,
): void {
  if (draft.done) throw new DraftError("The draft is over.");
  const queue = draft.queues[seat];
  const pack = queue?.[0];
  if (!pack || pack.id !== packId) throw new DraftError("That pack isn't in front of you anymore.");

  const need = turnCounts(pack, env.config);
  if (picks.length !== need.picks) throw new DraftError(`Pick exactly ${need.picks} card(s).`);
  if (burns.length !== need.burns) throw new DraftError(`Burn exactly ${need.burns} card(s).`);
  const chosen = [...picks, ...burns];
  if (new Set(chosen).size !== chosen.length) throw new DraftError("Each card can only be chosen once.");
  if (!chosen.every((iid) => pack.cards.includes(iid))) throw new DraftError("That card isn't in this pack.");

  const pickNumber = pack.picksTaken + 1;
  const playerId = draft.seats[seat];
  pack.cards = pack.cards.filter((iid) => !chosen.includes(iid));
  pack.picksTaken++;
  draft.picks[playerId].push(...picks);
  draft.burned.push(...burns);
  for (const iid of picks) draft.log.push({ seat, round: draft.round, pick: pickNumber, iid, auto });

  queue.shift();
  delete pack.deadline;
  setDeadline(queue[0], env);

  if (pack.cards.length > 0) {
    const target = passTarget(seat, draft.round, draft.seats.length, env.config);
    draft.queues[target].push(pack);
    if (draft.queues[target].length === 1) setDeadline(pack, env);
  }

  if (draft.queues.every((q) => q.length === 0)) {
    if (draft.round + 1 < env.config.packsPerPlayer) openRound(draft, draft.round + 1, env);
    else draft.done = true;
  }
}

/** Chooses picks + burns for a seat: best cards are picked, worst are burned. */
export function chooseAuto(draft: DraftState, seat: number, env: DraftEnv): { picks: string[]; burns: string[] } {
  const pack = draft.queues[seat][0];
  const picked = draft.picks[draft.seats[seat]].map((iid) => env.cards[env.instances[iid].cardId]);
  const affinity = colorAffinity(picked);
  const ranked = pack.cards
    .map((iid) => ({ iid, score: pickScore(env.cards[env.instances[iid].cardId], picked, affinity) + env.rng() * 0.05 }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.iid);
  const need = turnCounts(pack, env.config);
  return { picks: ranked.slice(0, need.picks), burns: need.burns > 0 ? ranked.slice(-need.burns) : [] };
}

export function autoPick(draft: DraftState, seat: number, env: DraftEnv): void {
  const pack = draft.queues[seat][0];
  if (!pack) return;
  const { picks, burns } = chooseAuto(draft, seat, env);
  makePick(draft, seat, pack.id, picks, burns, env, true);
}

/**
 * Lets bots pick and auto-picks expired timers until nothing else can happen right now.
 * `isBot(seat)` decides which seats are computer-controlled. Returns true if anything changed.
 */
export function advance(draft: DraftState, isBot: (seat: number) => boolean, env: DraftEnv): boolean {
  let changed = false;
  for (let guard = 0; guard < 10_000 && !draft.done; guard++) {
    const clockRunning = draft.pausedAt === undefined;
    const seat = draft.queues.findIndex(
      (q, s) => q.length > 0 && (isBot(s) || (clockRunning && q[0].deadline !== undefined && q[0].deadline <= env.now)),
    );
    if (seat < 0) break;
    autoPick(draft, seat, env);
    changed = true;
  }
  return changed;
}

export function nextDeadline(draft: DraftState): number | null {
  if (draft.pausedAt !== undefined) return null;
  let min: number | null = null;
  for (const q of draft.queues) {
    const d = q[0]?.deadline;
    if (d !== undefined && (min === null || d < min)) min = d;
  }
  return min;
}

/** Stops pick timers from expiring (e.g. everyone left). Returns true if the clock was running. */
export function pauseClock(draft: DraftState, now: number): boolean {
  if (draft.pausedAt !== undefined || draft.done) return false;
  draft.pausedAt = now;
  return true;
}

/** Restarts pick timers, giving back the time spent paused. Returns true if the clock was paused. */
export function resumeClock(draft: DraftState, now: number): boolean {
  if (draft.pausedAt === undefined) return false;
  const pausedFor = Math.max(0, now - draft.pausedAt);
  for (const queue of draft.queues) for (const pack of queue) if (pack.deadline !== undefined) pack.deadline += pausedFor;
  delete draft.pausedAt;
  return true;
}
