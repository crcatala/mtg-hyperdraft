// Freeform tabletop: state, actions, and per-player views that hide private information.
// No rules enforcement — just MTG conventions (zones, tapping, face-down, counters, life).

import type {
  CardData,
  CardMap,
  DeckState,
  CardInstance,
  LogEntry,
  TableCard,
  TablePlayer,
  TableState,
  TokenDef,
  ZoneName,
  BasicLand,
} from "./types";
import { ZONE_LABELS } from "./types";
import { shuffle, type Rng } from "./rng";
import { defaultBattlefieldSpot } from "./tableLayout";
import { isLand } from "./autopick";

export type TableAction =
  | { a: "move"; ids: string[]; to: ZoneName; x?: number; y?: number; bottom?: boolean; faceDown?: boolean; face?: number }
  | { a: "setPos"; id: string; x: number; y: number }
  | { a: "tap"; ids: string[]; tapped?: boolean }
  | { a: "untapAll" }
  | { a: "flip"; ids: string[] }
  | { a: "turnFace"; id: string }
  | { a: "draw"; n: number }
  | { a: "shuffle" }
  | { a: "mill"; n: number }
  | { a: "peek"; n: number }
  | { a: "life"; playerId: string; delta: number }
  | { a: "poison"; playerId: string; delta: number }
  | { a: "counter"; id: string; kind: string; delta: number }
  | { a: "token"; token?: TokenDef; cardId?: string; x?: number; y?: number; count?: number }
  | { a: "clone"; id: string }
  | { a: "mulligan" }
  | { a: "nextTurn" }
  | { a: "roll"; sides: number }
  | { a: "reveal"; ids: string[] };

export interface TableEnv {
  cards: CardMap;
  rng: Rng;
  now: number;
  nextId: (prefix: string) => string;
  names: Record<string, string>;
}

type HiddenZone = Exclude<ZoneName, "battlefield">;

export function createTable(
  seats: string[],
  decks: Record<string, DeckState>,
  instances: Record<string, CardInstance>,
  basicIds: Partial<Record<BasicLand, string>>,
  config: { startingLife: number; openingHandSize: number },
  env: TableEnv,
): TableState {
  const table: TableState = {
    seats: seats.slice(),
    players: {},
    cards: {},
    turn: { playerId: seats[0], number: 1 },
    nextZ: 1,
    log: [],
    peek: {},
    openingHandSize: config.openingHandSize,
  };
  seats.forEach((pid, seat) => {
    const deck = decks[pid];
    const player: TablePlayer = {
      id: pid,
      seat,
      life: config.startingLife,
      poison: 0,
      zones: { library: [], hand: [], graveyard: [], exile: [], sideboard: [] },
    };
    table.players[pid] = player;
    const add = (iid: string, cardId: string, zone: HiddenZone, foil?: boolean) => {
      table.cards[iid] = blankCard(iid, pid, zone, cardId, foil);
      player.zones[zone].push(iid);
    };
    for (const iid of deck?.main ?? []) add(iid, instances[iid].cardId, "library", instances[iid].foil);
    for (const iid of deck?.side ?? []) add(iid, instances[iid].cardId, "sideboard", instances[iid].foil);
    for (const [land, n] of Object.entries(deck?.basics ?? {}) as [BasicLand, number][]) {
      const cardId = basicIds[land];
      if (!cardId) continue;
      for (let i = 0; i < n; i++) add(env.nextId("b"), cardId, "library");
    }
    player.zones.library = shuffle(player.zones.library, env.rng);
    for (let i = 0; i < config.openingHandSize && player.zones.library.length > 0; i++) {
      moveCard(table, table.cards[player.zones.library[0]], "hand", env);
    }
  });
  log(table, seats[0], `The game begins — everyone drew ${config.openingHandSize}. Good luck!`, env);
  return table;
}

function blankCard(id: string, owner: string, zone: ZoneName, cardId?: string, foil?: boolean): TableCard {
  return {
    id,
    cardId,
    owner,
    controller: owner,
    zone,
    x: 0,
    y: 0,
    tapped: false,
    faceDown: false,
    face: 0,
    counters: {},
    z: 0,
    ...(foil ? { foil } : {}),
  };
}

export class TableError extends Error {}

function log(table: TableState, playerId: string, text: string, env: TableEnv) {
  const entry: LogEntry = { at: env.now, playerId, text };
  table.log.push(entry);
  if (table.log.length > 200) table.log.splice(0, table.log.length - 200);
}

export function cardName(table: TableState, id: string, env: TableEnv, forPublic = true): string {
  const card = table.cards[id];
  if (!card) return "a card";
  if (forPublic && card.faceDown && card.zone === "battlefield") return "a face-down card";
  if (card.token) return `${card.token.name} token`;
  const data = card.cardId ? env.cards[card.cardId] : undefined;
  if (!data) return "a card";
  return data.faces && card.face > 0 ? data.faces[card.face].name : data.name;
}

/** How many faces a card can be turned to (only double-faced cards with a printed image per face). */
export function faceCount(data: CardData | undefined): number {
  return data?.faces?.[1]?.images ? data.faces.length : 1;
}

function removeFromZone(table: TableState, card: TableCard) {
  if (card.zone === "battlefield") return;
  const zone = table.players[card.owner].zones[card.zone];
  const idx = zone.indexOf(card.id);
  if (idx >= 0) zone.splice(idx, 1);
}

function isPublicZone(zone: ZoneName) {
  return zone === "battlefield" || zone === "graveyard" || zone === "exile";
}

function battlefieldCount(table: TableState, owner: string): number {
  return Object.values(table.cards).filter((c) => c.zone === "battlefield" && c.controller === owner).length;
}

function placeOnBattlefield(table: TableState, card: TableCard, env: TableEnv, x?: number, y?: number) {
  const seat = table.players[card.controller]?.seat ?? 0;
  if (x === undefined || y === undefined) {
    const data = card.cardId ? env.cards[card.cardId] : undefined;
    const spot = defaultBattlefieldSpot(seat, table.seats.length, battlefieldCount(table, card.controller), !!data && isLand(data));
    x = spot.x;
    y = spot.y;
  }
  card.x = x;
  card.y = y;
  card.z = table.nextZ++;
}

function moveCard(
  table: TableState,
  card: TableCard,
  to: ZoneName,
  env: TableEnv,
  opts: { x?: number; y?: number; bottom?: boolean; faceDown?: boolean } = {},
) {
  const from = card.zone;
  removeFromZone(table, card);
  // Tokens stop existing once they leave the battlefield.
  if (card.token && to !== "battlefield") {
    delete table.cards[card.id];
    return;
  }
  if (from === "battlefield" && to !== "battlefield") {
    card.tapped = false;
    card.counters = {};
    card.face = 0;
    card.controller = card.owner;
  }
  card.zone = to;
  card.faceDown = opts.faceDown ?? (to === "battlefield" && from === "battlefield" ? card.faceDown : false);
  if (to === "battlefield") {
    placeOnBattlefield(table, card, env, opts.x, opts.y);
  } else {
    const zone = table.players[card.owner].zones[to];
    if (opts.bottom) zone.push(card.id);
    else if (to === "library") zone.unshift(card.id);
    else zone.push(card.id);
  }
}

/** Applies a player's action. Throws TableError for invalid ones. */
export function applyTableAction(table: TableState, playerId: string, action: TableAction, env: TableEnv): void {
  const me = table.players[playerId];
  if (!me) throw new TableError("You're not seated at this table.");
  const who = env.names[playerId] ?? "Someone";
  const getCard = (id: string) => {
    const card = table.cards[id];
    if (!card) throw new TableError("That card is gone.");
    return card;
  };
  // Acting on someone else's card is allowed (no rules engine), but the log names the owner so it's
  // never mistaken for their own move.
  const holder = (card: TableCard) => (card.zone === "battlefield" ? card.controller : card.owner);
  const label = (card: TableCard) => (holder(card) === playerId ? cardName(table, card.id, env) : `${env.names[holder(card)] ?? "someone"}'s ${cardName(table, card.id, env)}`);
  // Cards in hidden zones can only be touched by their owner.
  const assertCanTouch = (card: TableCard) => {
    if ((card.zone === "hand" || card.zone === "library" || card.zone === "sideboard") && card.owner !== playerId) {
      throw new TableError("That card belongs to someone else's private zone.");
    }
  };

  switch (action.a) {
    case "move": {
      const cards = action.ids.map(getCard);
      cards.forEach(assertCanTouch);
      const names: string[] = [];
      for (const [i, card] of cards.entries()) {
        const from = card.zone;
        // A double-faced card can enter the battlefield on the face its owner was looking at.
        if (action.to === "battlefield" && from !== "battlefield" && action.face !== undefined) {
          const data = card.cardId ? env.cards[card.cardId] : undefined;
          if (action.face < faceCount(data)) card.face = action.face;
        }
        const visible = isPublicZone(from) || isPublicZone(action.to);
        const shown = visible && !(action.faceDown && action.to === "battlefield");
        names.push(card.owner === playerId ? (shown ? cardName(table, card.id, env) : "a card") : `${env.names[card.owner] ?? "someone"}'s ${shown ? cardName(table, card.id, env) : "card"}`);
        const theirs = card.owner === playerId ? "their" : `${env.names[card.owner] ?? "someone"}'s`;
        // Spread multiple dropped cards a little so they don't stack perfectly.
        const x = action.x !== undefined ? action.x + i * 0.6 : undefined;
        const y = action.y !== undefined ? action.y + i * 0.2 : undefined;
        moveCard(table, card, action.to, env, { x, y, bottom: action.bottom, faceDown: action.faceDown });
        if (i === 0 && cards.length === 1) {
          const place = action.to === "library" ? (action.bottom ? `the bottom of ${theirs} library` : `the top of ${theirs} library`) : `${theirs} ${ZONE_LABELS[action.to].toLowerCase()}`;
          const fromLabel = from === action.to ? "" : ` from ${from === "battlefield" ? "the battlefield" : `${theirs} ${ZONE_LABELS[from].toLowerCase()}`}`;
          if (from !== action.to) log(table, playerId, `${who} moved ${names[0]}${fromLabel} to ${action.to === "battlefield" ? "the battlefield" : place}.`, env);
        }
      }
      if (cards.length > 1) log(table, playerId, `${who} moved ${cards.length} cards to ${ZONE_LABELS[action.to].toLowerCase()}.`, env);
      return;
    }
    case "setPos": {
      const card = getCard(action.id);
      if (card.zone !== "battlefield") throw new TableError("Only battlefield cards can be repositioned.");
      card.x = action.x;
      card.y = action.y;
      card.z = table.nextZ++;
      return;
    }
    case "tap": {
      const cards = action.ids.map(getCard).filter((c) => c.zone === "battlefield");
      if (cards.length === 0) return;
      const target = action.tapped ?? !cards[0].tapped;
      for (const c of cards) c.tapped = target;
      const foreign = cards.filter((c) => c.controller !== playerId).length;
      const what = cards.length === 1 ? label(cards[0]) : `${cards.length} cards${foreign ? ` (${foreign} not theirs)` : ""}`;
      log(table, playerId, `${who} ${target ? "tapped" : "untapped"} ${what}.`, env);
      return;
    }
    case "untapAll": {
      for (const c of Object.values(table.cards)) if (c.zone === "battlefield" && c.controller === playerId) c.tapped = false;
      log(table, playerId, `${who} untapped everything.`, env);
      return;
    }
    case "flip": {
      for (const card of action.ids.map(getCard)) {
        if (card.zone !== "battlefield") continue;
        card.faceDown = !card.faceDown;
        const whose = card.controller === playerId ? "" : `${env.names[card.controller] ?? "someone"}'s `;
        log(table, playerId, `${who} turned ${card.faceDown ? `${whose || "a "}card face down` : `${label(card)} face up`}.`, env);
      }
      return;
    }
    case "turnFace": {
      const card = getCard(action.id);
      const faces = faceCount(card.cardId ? env.cards[card.cardId] : undefined);
      if (faces < 2) throw new TableError("That card has only one face.");
      card.face = (card.face + 1) % faces;
      log(table, playerId, `${who} transformed ${holder(card) === playerId ? "it" : `${env.names[holder(card)] ?? "someone"}'s card`} into ${cardName(table, card.id, env)}.`, env);
      return;
    }
    case "draw": {
      const n = clampCount(action.n);
      let drawn = 0;
      for (let i = 0; i < n && me.zones.library.length > 0; i++) {
        moveCard(table, table.cards[me.zones.library[0]], "hand", env);
        drawn++;
      }
      if (drawn === 0) throw new TableError("Your library is empty.");
      log(table, playerId, `${who} drew ${drawn === 1 ? "a card" : `${drawn} cards`}.`, env);
      return;
    }
    case "shuffle": {
      me.zones.library = shuffle(me.zones.library, env.rng);
      delete table.peek[playerId];
      log(table, playerId, `${who} shuffled their library.`, env);
      return;
    }
    case "mill": {
      const n = clampCount(action.n);
      const milled: string[] = [];
      for (let i = 0; i < n && me.zones.library.length > 0; i++) {
        const id = me.zones.library[0];
        moveCard(table, table.cards[id], "graveyard", env);
        milled.push(cardName(table, id, env));
      }
      log(table, playerId, `${who} milled ${milled.length}: ${milled.join(", ") || "nothing"}.`, env);
      return;
    }
    case "peek": {
      const n = Math.max(0, Math.min(action.n, me.zones.library.length));
      if (n === 0) delete table.peek[playerId];
      else {
        table.peek[playerId] = n;
        const all = n >= me.zones.library.length;
        log(table, playerId, all ? `${who} is searching their library.` : `${who} looked at the top ${n} card(s) of their library.`, env);
      }
      return;
    }
    case "life":
    case "poison": {
      const target = table.players[action.playerId];
      if (!target) throw new TableError("No such player.");
      const before = action.a === "life" ? target.life : target.poison;
      if (action.a === "life") target.life += action.delta;
      else target.poison = Math.max(0, target.poison + action.delta);
      const value = action.a === "life" ? target.life : target.poison;
      // Nothing changed (e.g. the life field was opened and closed): no log line.
      if (value === before) return;
      const name = env.names[action.playerId] ?? "Someone";
      const change = value - before;
      const sign = change > 0 ? `+${change}` : `${change}`;
      log(table, playerId, `${name}'s ${action.a === "life" ? "life" : "poison"}: ${sign} → ${value}${action.playerId !== playerId ? ` (by ${who})` : ""}.`, env);
      return;
    }
    case "counter": {
      const card = getCard(action.id);
      const kind = action.kind.trim().slice(0, 24) || "+1/+1";
      const next = (card.counters[kind] ?? 0) + action.delta;
      if (next === 0) delete card.counters[kind];
      else card.counters[kind] = next;
      log(table, playerId, `${who} ${action.delta > 0 ? "added" : "removed"} a ${kind} counter ${action.delta > 0 ? "to" : "from"} ${label(card)} (${next}).`, env);
      return;
    }
    case "token": {
      if (!action.token && !action.cardId) throw new TableError("Describe the token first.");
      const count = Math.max(1, Math.min(20, action.count ?? 1));
      for (let i = 0; i < count; i++) {
        const id = env.nextId("t");
        const card = blankCard(id, playerId, "battlefield", action.cardId);
        if (action.token) card.token = { ...action.token, name: action.token.name.slice(0, 40) || "Token" };
        else card.token = { name: env.cards[action.cardId!]?.name ?? "Token", colors: env.cards[action.cardId!]?.colors ?? [] };
        table.cards[id] = card;
        placeOnBattlefield(table, card, env, action.x !== undefined ? action.x + i * 0.7 : undefined, action.y);
      }
      const name = action.token?.name ?? env.cards[action.cardId!]?.name ?? "Token";
      log(table, playerId, `${who} created ${count > 1 ? `${count} ${name} tokens` : `a ${name} token`}.`, env);
      return;
    }
    case "clone": {
      const src = getCard(action.id);
      if (src.zone !== "battlefield") throw new TableError("Only battlefield cards can be copied.");
      const id = env.nextId("t");
      const card = blankCard(id, playerId, "battlefield", src.cardId);
      card.token = src.token ?? { name: cardName(table, src.id, env), colors: src.cardId ? env.cards[src.cardId]?.colors ?? [] : [] };
      card.face = src.face;
      table.cards[id] = card;
      placeOnBattlefield(table, card, env, src.x + 1, src.y + 0.5);
      log(table, playerId, `${who} created a token copy of ${cardName(table, src.id, env)}.`, env);
      return;
    }
    case "mulligan": {
      for (const id of me.zones.hand.slice()) moveCard(table, table.cards[id], "library", env);
      me.zones.library = shuffle(me.zones.library, env.rng);
      const n = table.openingHandSize;
      for (let i = 0; i < n && me.zones.library.length > 0; i++) moveCard(table, table.cards[me.zones.library[0]], "hand", env);
      log(table, playerId, `${who} took a mulligan (shuffled their hand away and drew ${n}). Put cards on the bottom as needed.`, env);
      return;
    }
    case "nextTurn": {
      const idx = table.seats.indexOf(table.turn.playerId);
      const next = table.seats[(idx + 1) % table.seats.length];
      table.turn = { playerId: next, number: table.turn.number + (idx + 1 === table.seats.length ? 1 : 0) };
      log(table, playerId, `It's ${env.names[next] ?? "someone"}'s turn (round ${table.turn.number}).`, env);
      return;
    }
    case "roll": {
      const sides = Math.max(2, Math.min(100, Math.floor(action.sides)));
      const result = 1 + Math.floor(env.rng() * sides);
      log(table, playerId, sides === 2 ? `${who} flipped a coin: ${result === 1 ? "heads" : "tails"}.` : `${who} rolled a d${sides}: ${result}.`, env);
      return;
    }
    case "reveal": {
      const cards = action.ids.map(getCard);
      cards.forEach(assertCanTouch);
      log(table, playerId, `${who} revealed ${cards.map((c) => cardName(table, c.id, env, false)).join(", ")}.`, env);
      return;
    }
  }
}

function clampCount(n: number) {
  return Math.max(1, Math.min(60, Math.floor(n) || 1));
}

// --- Views ------------------------------------------------------------------------------------

/** What one player may see: other players' hands, all libraries (except peeks) and face-down cards are hidden. */
export function tableViewFor(table: TableState, viewer: string): TableState {
  const peekIds = new Set<string>();
  const peekN = table.peek[viewer] ?? 0;
  if (peekN > 0) table.players[viewer]?.zones.library.slice(0, peekN).forEach((id) => peekIds.add(id));

  const cards: Record<string, TableCard> = {};
  for (const card of Object.values(table.cards)) {
    const visible =
      card.zone === "graveyard" ||
      card.zone === "exile" ||
      (card.zone === "battlefield" && (!card.faceDown || card.controller === viewer || card.owner === viewer)) ||
      ((card.zone === "hand" || card.zone === "sideboard") && card.owner === viewer) ||
      (card.zone === "library" && peekIds.has(card.id));
    cards[card.id] = visible ? card : { ...card, cardId: undefined, token: undefined, face: 0, hidden: true };
  }
  return { ...table, cards };
}
