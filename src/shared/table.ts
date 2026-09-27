// Freeform tabletop: state, actions, and per-player views that hide private information.
// No rules enforcement — just MTG conventions (zones, tapping, face-down, counters, life).

import type {
  CardData,
  CardMap,
  DeckState,
  CardInstance,
  LogEntry,
  LogKind,
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
import { card as cardText, joinLog, logText, num, player, verb, zone, type LogPiece, type LogText } from "./logText";

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
  log(table, seats[0], "start", logText`The game begins — everyone drew ${num(config.openingHandSize)}. Good luck!`, env);
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

function log(table: TableState, playerId: string, kind: LogKind, line: LogText, env: TableEnv) {
  const entry: LogEntry = { at: env.now, playerId, text: line.text, kind };
  if (line.marks.length) entry.marks = line.marks;
  table.log.push(entry);
  if (table.log.length > 200) table.log.splice(0, table.log.length - 200);
}

export function cardName(table: TableState, id: string, env: TableEnv, forPublic = true): string {
  return cardRef(table, id, env, forPublic).text;
}

/** A card's name for the log, marked as a card (a link to its image) when it's known. */
function cardRef(table: TableState, id: string, env: TableEnv, forPublic = true): LogText {
  const card = table.cards[id];
  if (!card) return logText`a card`;
  if (forPublic && card.faceDown && card.zone === "battlefield") return logText`a face-down card`;
  if (card.token) return logText`${cardText(card.token.name, card.cardId)} token`;
  const data = card.cardId ? env.cards[card.cardId] : undefined;
  if (!data) return logText`a card`;
  return data.faces && card.face > 0 ? cardText(data.faces[card.face].name, data.id, card.face) : cardText(data.name, data.id);
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
  const who = player(playerId, env.names[playerId] ?? "Someone");
  const someone = (id: string) => player(id, env.names[id] ?? "someone");
  const getCard = (id: string) => {
    const card = table.cards[id];
    if (!card) throw new TableError("That card is gone.");
    return card;
  };
  // Acting on someone else's card is allowed (no rules engine), but the log names the owner so it's
  // never mistaken for their own move.
  const holder = (card: TableCard) => (card.zone === "battlefield" ? card.controller : card.owner);
  const label = (card: TableCard): LogPiece => (holder(card) === playerId ? cardRef(table, card.id, env) : logText`${someone(holder(card))}'s ${cardRef(table, card.id, env)}`);
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
      const names: LogPiece[] = [];
      for (const [i, card] of cards.entries()) {
        const from = card.zone;
        // A double-faced card can enter the battlefield on the face its owner was looking at.
        if (action.to === "battlefield" && from !== "battlefield" && action.face !== undefined) {
          const data = card.cardId ? env.cards[card.cardId] : undefined;
          if (action.face < faceCount(data)) card.face = action.face;
        }
        const visible = isPublicZone(from) || isPublicZone(action.to);
        const shown = visible && !(action.faceDown && action.to === "battlefield");
        names.push(card.owner === playerId ? (shown ? cardRef(table, card.id, env) : "a card") : logText`${someone(card.owner)}'s ${shown ? cardRef(table, card.id, env) : "card"}`);
        const theirs: LogPiece = card.owner === playerId ? "their" : logText`${someone(card.owner)}'s`;
        // Spread multiple dropped cards a little so they don't stack perfectly.
        const x = action.x !== undefined ? action.x + i * 0.6 : undefined;
        const y = action.y !== undefined ? action.y + i * 0.2 : undefined;
        moveCard(table, card, action.to, env, { x, y, bottom: action.bottom, faceDown: action.faceDown });
        if (i === 0 && cards.length === 1) {
          const place = action.to === "library" ? logText`the ${action.bottom ? "bottom" : "top"} of ${theirs} ${zone("library")}` : logText`${theirs} ${zone(ZONE_LABELS[action.to].toLowerCase())}`;
          const fromLabel = from === action.to ? "" : logText` from ${from === "battlefield" ? zone("the battlefield") : logText`${theirs} ${zone(ZONE_LABELS[from].toLowerCase())}`}`;
          if (from !== action.to) log(table, playerId, action.to, logText`${who} ${verb("moved")} ${names[0]}${fromLabel} to ${action.to === "battlefield" ? zone("the battlefield") : place}.`, env);
        }
      }
      if (cards.length > 1) log(table, playerId, action.to, logText`${who} ${verb("moved")} ${num(cards.length)} cards to ${zone(ZONE_LABELS[action.to].toLowerCase())}.`, env);
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
      const what = cards.length === 1 ? label(cards[0]) : logText`${num(cards.length)} cards${foreign ? ` (${foreign} not theirs)` : ""}`;
      log(table, playerId, target ? "tap" : "untap", logText`${who} ${verb(target ? "tapped" : "untapped")} ${what}.`, env);
      return;
    }
    case "untapAll": {
      for (const c of Object.values(table.cards)) if (c.zone === "battlefield" && c.controller === playerId) c.tapped = false;
      log(table, playerId, "untap", logText`${who} ${verb("untapped")} everything.`, env);
      return;
    }
    case "flip": {
      for (const card of action.ids.map(getCard)) {
        if (card.zone !== "battlefield") continue;
        card.faceDown = !card.faceDown;
        const whose = card.controller === playerId ? "a " : logText`${someone(card.controller)}'s `;
        log(table, playerId, "flip", logText`${who} ${verb("turned")} ${card.faceDown ? logText`${whose}card face down` : logText`${label(card)} face up`}.`, env);
      }
      return;
    }
    case "turnFace": {
      const card = getCard(action.id);
      const faces = faceCount(card.cardId ? env.cards[card.cardId] : undefined);
      if (faces < 2) throw new TableError("That card has only one face.");
      card.face = (card.face + 1) % faces;
      log(table, playerId, "transform", logText`${who} ${verb("transformed")} ${holder(card) === playerId ? "it" : logText`${someone(holder(card))}'s card`} into ${cardRef(table, card.id, env)}.`, env);
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
      log(table, playerId, "draw", logText`${who} ${verb("drew")} ${drawn === 1 ? "a card" : logText`${num(drawn)} cards`}.`, env);
      return;
    }
    case "shuffle": {
      me.zones.library = shuffle(me.zones.library, env.rng);
      delete table.peek[playerId];
      log(table, playerId, "shuffle", logText`${who} ${verb("shuffled")} their ${zone("library")}.`, env);
      return;
    }
    case "mill": {
      const n = clampCount(action.n);
      const milled: LogText[] = [];
      for (let i = 0; i < n && me.zones.library.length > 0; i++) {
        const id = me.zones.library[0];
        moveCard(table, table.cards[id], "graveyard", env);
        milled.push(cardRef(table, id, env));
      }
      log(table, playerId, "mill", logText`${who} ${verb("milled")} ${num(milled.length)}: ${milled.length ? joinLog(milled, ", ") : "nothing"}.`, env);
      return;
    }
    case "peek": {
      const n = Math.max(0, Math.min(action.n, me.zones.library.length));
      if (n === 0) delete table.peek[playerId];
      else {
        table.peek[playerId] = n;
        const all = n >= me.zones.library.length;
        log(table, playerId, "peek", all ? logText`${who} is ${verb("searching")} their ${zone("library")}.` : logText`${who} ${verb("looked at")} the top ${num(n)} card(s) of their ${zone("library")}.`, env);
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
      const name = player(action.playerId, env.names[action.playerId] ?? "Someone");
      const change = value - before;
      const sign = change > 0 ? `+${change}` : `${change}`;
      // Gaining life is good news; gaining poison is not.
      const tone = change > 0 === (action.a === "life") ? "good" : "bad";
      const by = action.playerId !== playerId ? logText` (by ${who})` : "";
      log(table, playerId, action.a, logText`${name}'s ${verb(action.a)}: ${num(sign, tone)} → ${num(value)}${by}.`, env);
      return;
    }
    case "counter": {
      const card = getCard(action.id);
      const kind = action.kind.trim().slice(0, 24) || "+1/+1";
      const next = (card.counters[kind] ?? 0) + action.delta;
      if (next === 0) delete card.counters[kind];
      else card.counters[kind] = next;
      log(table, playerId, "counter", logText`${who} ${verb(action.delta > 0 ? "added" : "removed")} a ${kind} counter ${action.delta > 0 ? "to" : "from"} ${label(card)} (${num(next)}).`, env);
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
      const name = cardText(action.token?.name ?? env.cards[action.cardId!]?.name ?? "Token", action.cardId && env.cards[action.cardId] ? action.cardId : undefined);
      log(table, playerId, "token", logText`${who} ${verb("created")} ${count > 1 ? logText`${num(count)} ${name} tokens` : logText`a ${name} token`}.`, env);
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
      log(table, playerId, "token", logText`${who} ${verb("created")} a token copy of ${cardRef(table, src.id, env)}.`, env);
      return;
    }
    case "mulligan": {
      for (const id of me.zones.hand.slice()) moveCard(table, table.cards[id], "library", env);
      me.zones.library = shuffle(me.zones.library, env.rng);
      const n = table.openingHandSize;
      for (let i = 0; i < n && me.zones.library.length > 0; i++) moveCard(table, table.cards[me.zones.library[0]], "hand", env);
      log(table, playerId, "mulligan", logText`${who} ${verb("took a mulligan")} (shuffled their hand away and drew ${num(n)}). Put cards on the bottom as needed.`, env);
      return;
    }
    case "nextTurn": {
      const idx = table.seats.indexOf(table.turn.playerId);
      const next = table.seats[(idx + 1) % table.seats.length];
      table.turn = { playerId: next, number: table.turn.number + (idx + 1 === table.seats.length ? 1 : 0) };
      log(table, playerId, "turn", logText`It's ${someone(next)}'s turn (round ${num(table.turn.number)}).`, env);
      return;
    }
    case "roll": {
      const sides = Math.max(2, Math.min(100, Math.floor(action.sides)));
      const result = 1 + Math.floor(env.rng() * sides);
      log(table, playerId, "roll", sides === 2 ? logText`${who} ${verb("flipped a coin")}: ${num(result === 1 ? "heads" : "tails")}.` : logText`${who} ${verb(`rolled a d${sides}`)}: ${num(result)}.`, env);
      return;
    }
    case "reveal": {
      const cards = action.ids.map(getCard);
      cards.forEach(assertCanTouch);
      log(table, playerId, "reveal", logText`${who} ${verb("revealed")} ${joinLog(cards.map((c) => cardRef(table, c.id, env, false)), ", ")}.`, env);
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
