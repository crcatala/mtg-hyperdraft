// Freeform tabletop: state, actions, and per-player views that hide private information.
// No rules enforcement — just MTG conventions (zones, tapping, face-down, counters, life).

import type {
  CardData,
  CardMap,
  DeckState,
  CardInstance,
  LogEntry,
  LogKind,
  LibraryPeek,
  PublicLook,
  TableCard,
  TablePlayer,
  TableState,
  TokenDef,
  ZoneName,
  BasicLand,
} from "./types";
import { ZONE_LABELS } from "./types";
import { randomCode, shuffle, type Rng } from "./rng";
import { defaultBattlefieldSpot } from "./tableLayout";
import { isLand } from "./autopick";
import { card as cardText, joinLog, logText, num, player, verb, zone, type LogPiece, type LogText } from "./logText";

export type TableAction =
  | { a: "move"; ids: string[]; to: ZoneName; x?: number; y?: number; bottom?: boolean; faceDown?: boolean; face?: number }
  | { a: "setPos"; id: string; x: number; y: number }
  /** Repositions a dropped group of battlefield cards in one go (one message, one write). */
  | { a: "place"; cards: { id: string; x: number; y: number }[] }
  | { a: "tap"; ids: string[]; tapped?: boolean }
  | { a: "untapAll" }
  | { a: "flip"; ids: string[] }
  | { a: "turnFace"; id: string }
  | { a: "draw"; n: number }
  | { a: "shuffle" }
  | { a: "mill"; n: number }
  | { a: "peek"; n: number; search?: boolean }
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
      shuffles: 0,
      mulligans: 0,
    };
    table.players[pid] = player;
    const add = (cardId: string, zone: HiddenZone, foil?: boolean) => {
      const id = opaqueCardId(table, env.rng);
      table.cards[id] = blankCard(id, pid, zone, cardId, foil);
      player.zones[zone].push(id);
    };
    for (const iid of deck?.main ?? []) add(instances[iid].cardId, "library", instances[iid].foil);
    for (const iid of deck?.side ?? []) add(instances[iid].cardId, "sideboard", instances[iid].foil);
    for (const [land, n] of Object.entries(deck?.basics ?? {}) as [BasicLand, number][]) {
      const cardId = basicIds[land];
      if (!cardId) continue;
      for (let i = 0; i < n; i++) add(cardId, "library");
    }
    player.zones.library = shuffle(player.zones.library, env.rng);
    for (let i = 0; i < config.openingHandSize && player.zones.library.length > 0; i++) {
      moveCard(table, table.cards[player.zones.library[0]], "hand", env);
    }
  });
  // Views sort by the ids each player sees; the stored order says nothing either (random id, not
  // decklist-then-basics).
  table.cards = Object.fromEntries(Object.entries(table.cards).sort(([a], [b]) => (a < b ? -1 : 1)));
  syncStandIns(table, env.rng);
  log(table, seats[0], "start", logText`The game begins — everyone drew ${num(config.openingHandSize)}. Good luck!`, env);
  return table;
}

/**
 * A fresh random id for a deck card. Draft instance ids were shown to other drafters with their
 * cards, and anything derived from the card, the decklist or the library order would give hidden
 * cards away too, so table ids are random and all look alike. (Tokens keep their "t" ids: they're public.)
 */
function opaqueCardId(table: TableState, rng: Rng): string {
  let id: string;
  do id = `k${randomCode(rng, 10)}`;
  while (table.cards[id]);
  return id;
}

// --- Stand-in ids -----------------------------------------------------------------------------
// A real id seen once (a card revealed, milled, bounced) would let anyone follow that card through
// hidden zones, even through a shuffle. So each player sees hidden cards under stand-in ids that
// look just like real ones: kept while the card stays out of sight (face-down cards, draws and
// scrying stay trackable, as at a real table), redrawn whenever a real table would lose track of it.

/**
 * Which cards `viewer` may see: not other players' hands and sideboards, not face-down cards they
 * neither own nor control, and not libraries (bar the cards of their own look).
 */
function sightOf(table: TableState, viewer: string): (card: TableCard) => boolean {
  const own = activePeek(table, viewer);
  const peekIds = new Set(own?.search ? table.players[viewer]?.zones.library : own?.ids);
  return (card) =>
    card.zone === "graveyard" ||
    card.zone === "exile" ||
    (card.zone === "battlefield" && (!card.faceDown || card.controller === viewer || card.owner === viewer)) ||
    ((card.zone === "hand" || card.zone === "sideboard") && card.owner === viewer) ||
    (card.zone === "library" && peekIds.has(card.id));
}

/** Every stand-in in use, for newStandIn to steer clear of. */
function standInsInUse(table: TableState): Set<string> {
  return new Set(Object.values(table.standIns ?? {}).flatMap((m) => Object.values(m)));
}

/** A random stand-in: never a real card id, and never one in `taken` (which it joins). */
function newStandIn(table: TableState, rng: Rng, taken: Set<string>): string {
  let id: string;
  do id = opaqueCardId(table, rng);
  while (taken.has(id));
  taken.add(id);
  return id;
}

/** New stand-ins for these cards, for every player (or everyone but `except`). */
function redrawStandIns(table: TableState, ids: string[], rng: Rng, except?: string) {
  const all = (table.standIns ??= {});
  const taken = standInsInUse(table);
  for (const viewer of table.seats) {
    if (viewer === except) continue;
    const mine = (all[viewer] ??= {});
    for (const id of ids) mine[id] = newStandIn(table, rng, taken);
  }
}

/**
 * Brings every player's stand-ins in line with what they can see now: none for cards they see, and
 * one for every card they don't. A card that just went out of sight was public a moment ago, so it
 * keeps its real id (the client can follow it to where it went) until something redraws it. A
 * table without stand-ins yet (a new game, or one saved before them) gets random ones throughout.
 */
export function syncStandIns(table: TableState, rng: Rng) {
  const fresh = !table.standIns;
  const all = (table.standIns ??= {});
  const taken = new Set<string>();
  for (const viewer of table.seats) {
    const sees = sightOf(table, viewer);
    const mine = (all[viewer] ??= {});
    for (const id of Object.keys(mine)) if (!table.cards[id]) delete mine[id];
    for (const card of Object.values(table.cards)) {
      if (sees(card)) delete mine[card.id];
      else mine[card.id] ??= fresh ? newStandIn(table, rng, taken) : card.id;
    }
  }
}

/** The id relayed drags of a card from this player's hand go by (not the card's: see Room's "drag"). */
export function handDragId(owner: string): string {
  return `hand:${owner}`;
}

/** The id `viewer` knows a card by. */
export function shownId(table: TableState, viewer: string, id: string): string {
  return table.standIns?.[viewer]?.[id] ?? id;
}

/**
 * Maps ids as `viewer` knows them back to real ones. Anything else is refused the same way,
 * including the real id of a card hidden from them (it may have been public once).
 */
export function realIdsFor(table: TableState, viewer: string): (shown: string) => string {
  const mine = table.standIns?.[viewer] ?? {};
  const back = new Map(Object.entries(mine).map(([real, standIn]) => [standIn, real]));
  return (shown) => {
    const real = back.get(shown) ?? (!Object.hasOwn(mine, shown) && Object.hasOwn(table.cards, shown) ? shown : undefined);
    if (real === undefined) throw new TableError("That card is gone.");
    return real;
  };
}

/** An action as a player sent it (with the ids they see), with real card ids. */
export function resolveTableAction(table: TableState, viewer: string, action: TableAction): TableAction {
  const real = realIdsFor(table, viewer);
  switch (action.a) {
    case "move":
    case "tap":
    case "flip":
    case "reveal":
      return { ...action, ids: action.ids.map(real) };
    case "setPos":
    case "turnFace":
    case "counter":
    case "clone":
      return { ...action, id: real(action.id) };
    case "place":
      return { ...action, cards: action.cards.map((c) => ({ ...c, id: real(c.id) })) };
    default:
      return action;
  }
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
  if (card.token) return logText`${cardText(card.token.name, card.cardId, card.face)} token`;
  const data = card.cardId ? env.cards[card.cardId] : undefined;
  if (!data) return logText`a card`;
  return data.faces && card.face > 0 ? cardText(data.faces[card.face].name, data.id, card.face) : cardText(data.name, data.id);
}

/** How many faces a card can be turned to (only double-faced cards with a printed image per face). */
export function faceCount(data: CardData | undefined): number {
  return data?.faces?.[1]?.images ? data.faces.length : 1;
}

/**
 * The player's current look at their library, if any. Rooms saved before looks were snapshots
 * stored a bare count here; those read as no look (the player just opens it again).
 */
export function activePeek(table: TableState, playerId: string): LibraryPeek | undefined {
  const peek = table.peek[playerId] as LibraryPeek | number | undefined;
  return typeof peek === "object" && Array.isArray(peek.ids) ? peek : undefined;
}

/** Once a card being looked at goes anywhere (even back on top), the look is done with it. */
function leavePeek(table: TableState, card: TableCard) {
  const peek = activePeek(table, card.owner);
  if (!peek || peek.search) return;
  const idx = peek.ids.indexOf(card.id);
  if (idx < 0) return;
  peek.ids.splice(idx, 1);
  if (peek.ids.length === 0) delete table.peek[card.owner];
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
  const look = activePeek(table, card.owner);
  const inLook = from === "library" && !!look && (look.search || look.ids.includes(card.id));
  removeFromZone(table, card);
  leavePeek(table, card);
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
  // Out of a hand or sideboard without being shown: the others can't tell which of those cards it
  // was, so it and the rest of that zone get new stand-ins (else a card they saw go into the hand
  // could be followed onto the library or face down onto the battlefield).
  const shown = isPublicZone(to) && !(to === "battlefield" && card.faceDown);
  if ((from === "hand" || from === "sideboard") && to !== from && !shown) {
    redrawStandIns(table, [card.id, ...table.players[card.owner].zones[from]], env.rng, card.owner);
  }
  // Likewise out of a look at the library (a search, or the top few), unless back onto it from the
  // top few (scrying to the top or bottom is done in plain sight).
  if (inLook && !shown && (to !== "library" || look!.search)) {
    redrawStandIns(table, [card.id, ...table.players[card.owner].zones.library], env.rng, card.owner);
  }
}

/** Shuffling breaks every link to the library's cards, for everyone (its owner included). */
function shuffleLibrary(table: TableState, playerId: string, env: TableEnv) {
  const p = table.players[playerId];
  p.zones.library = shuffle(p.zones.library, env.rng);
  p.shuffles = (p.shuffles ?? 0) + 1;
  delete table.peek[playerId];
  redrawStandIns(table, p.zones.library, env.rng);
}

/**
 * Applies a player's action (with real card ids: see resolveTableAction). Throws TableError for
 * invalid ones.
 */
export function applyTableAction(table: TableState, playerId: string, action: TableAction, env: TableEnv): void {
  try {
    applyAction(table, playerId, action, env);
  } finally {
    syncStandIns(table, env.rng);
  }
}

function applyAction(table: TableState, playerId: string, action: TableAction, env: TableEnv): void {
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
          // Same-zone moves are just reordering, except in the library: at a real table everyone sees a
          // scried card go to the top or bottom (just not which card).
          if (from !== action.to || from === "library") log(table, playerId, action.to, logText`${who} ${verb("moved")} ${names[0]}${fromLabel} to ${action.to === "battlefield" ? zone("the battlefield") : place}.`, env);
        }
      }
      if (cards.length > 1) log(table, playerId, action.to, logText`${who} ${verb("moved")} ${num(cards.length)} cards to ${zone(ZONE_LABELS[action.to].toLowerCase())}.`, env);
      return;
    }
    case "setPos":
    case "place": {
      const moves = action.a === "setPos" ? [action] : action.cards;
      const cards = moves.map((m) => getCard(m.id));
      if (cards.some((c) => c.zone !== "battlefield")) throw new TableError("Only battlefield cards can be repositioned.");
      moves.forEach((m, i) => {
        cards[i].x = m.x;
        cards[i].y = m.y;
        cards[i].z = table.nextZ++;
      });
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
      // Anywhere else (or face down, to anyone who can't see it) the log or the refusal would say
      // what the hidden card is.
      if (card.zone !== "battlefield") throw new TableError("Only battlefield cards can be transformed.");
      if (card.faceDown && card.owner !== playerId && card.controller !== playerId) throw new TableError("You can't transform a face-down card you can't see.");
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
      shuffleLibrary(table, playerId, env);
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
      const library = me.zones.library;
      const n = action.search ? library.length : Math.max(0, Math.min(Math.floor(action.n), library.length));
      if (n === 0) {
        delete table.peek[playerId];
        return;
      }
      if (action.search) {
        table.peek[playerId] = { n, ids: [], search: true };
        log(table, playerId, "peek", logText`${who} is ${verb("searching")} their ${zone("library")}.`, env);
      } else {
        table.peek[playerId] = { n, ids: library.slice(0, n) };
        log(table, playerId, "peek", logText`${who} ${verb("looked at")} the top ${num(n)} card(s) of their ${zone("library")}.`, env);
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
      // Counters leave with the card anyway; on a hidden card they'd mark it (and the log names it).
      if (card.zone !== "battlefield") throw new TableError("Only battlefield cards can have counters.");
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
      // The copy would be face up, showing everyone what the hidden card is.
      if (src.faceDown) throw new TableError("Face-down cards can't be copied.");
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
      shuffleLibrary(table, playerId, env);
      me.mulligans = (me.mulligans ?? 0) + 1;
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

/**
 * Someone changed the table or the environment around it (cosmetic, see shared/scene.ts; the room keeps the
 * choice): one line so everyone knows who did it. Takes the display names.
 */
export function logSceneChange(table: TableState, playerId: string, change: { table?: string; env?: string }, env: TableEnv) {
  const who = player(playerId, env.names[playerId] ?? "Someone");
  const line =
    change.table && change.env
      ? logText`${who} ${verb("set the scene")}: ${num(change.table)} in the ${num(change.env)}.`
      : change.table
        ? logText`${who} ${verb("changed the table")} to ${num(change.table)}.`
        : logText`${who} ${verb("moved the game")} to the ${num(change.env ?? "")}.`;
  log(table, playerId, "scene", line, env);
}

function clampCount(n: number) {
  return Math.max(1, Math.min(60, Math.floor(n) || 1));
}

// --- Views ------------------------------------------------------------------------------------

/**
 * What one player may see (see sightOf). Hidden cards come under the viewer's stand-in ids, with
 * nothing left that could tell them apart: no card, token or foil, and no position left over from
 * an earlier trip to the battlefield.
 */
export function tableViewFor(table: TableState, viewer: string): TableState {
  const own = activePeek(table, viewer);
  const sees = sightOf(table, viewer);
  const shown = (id: string) => shownId(table, viewer, id);

  const list: TableCard[] = [];
  for (const card of Object.values(table.cards)) {
    if (sees(card)) list.push(card);
    else {
      const offTable = card.zone !== "battlefield" ? { x: 0, y: 0, z: 0, counters: {} } : {};
      list.push({ ...card, id: shown(card.id), cardId: undefined, token: undefined, face: 0, foil: undefined, hidden: true, ...offTable });
    }
  }
  // Key order reaches the client too: by the ids the viewer sees, not the real ones.
  list.sort((a, b) => (a.id < b.id ? -1 : 1));
  const cards = Object.fromEntries(list.map((c) => [c.id, c]));
  const players: Record<string, TablePlayer> = {};
  for (const [pid, p] of Object.entries(table.players)) {
    const zones = Object.fromEntries(Object.entries(p.zones).map(([zone, ids]) => [zone, ids.map(shown)])) as TablePlayer["zones"];
    players[pid] = { ...p, zones };
  }
  // Only your own look's cards are anyone's business, but everyone sees that a look is happening.
  const looks: Record<string, PublicLook> = {};
  for (const pid of table.seats) {
    const peek = activePeek(table, pid);
    if (peek) looks[pid] = peek.search ? { kind: "search" } : { kind: "top", n: peek.n, left: peek.ids.length };
  }
  const { standIns: _, ...rest } = table;
  return { ...rest, cards, players, peek: own ? { [viewer]: own } : {}, looks };
}
