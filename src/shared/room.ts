// The whole game room as a pure state machine: lobby → drafting → deckbuilding → playing.
// The Durable Object wraps this with sockets, persistence and alarms; tests drive it directly.

import type { ClientMessage, CubeSummary, DebugCommand, DraftView, RoomView, ServerMessage } from "./protocol";
import type { CardData, CardInstance, CardMap, DeckState, LobbyConfig, Player, RoomState, BasicLand } from "./types";
import { DEFAULT_CONFIG, MAX_HUMANS, MAX_SEATS } from "./types";
import { advance, autoPick, createDraft, DraftError, makePick, nextDeadline, normalizeDraftConfig, pauseClock, poolStats, resumeClock, seatOf, turnCounts, validatePool, type DraftEnv } from "./draft";
import { autoBuild, deckSize, newDeck } from "./deck";
import { applyTableAction, createTable, logSceneChange, logTreat, handDragId, realIdsFor, resolveTableAction, shownId, syncStandIns, TableError, tableViewFor, type TableEnv } from "./table";
import { randomCode, type Rng } from "./rng";
import type { RoomSummary } from "./invites";
import { PUBLIC_LIMITS } from "./publicRooms";
import { AVATAR_IDS, COMPANION_IDS, isAvatarId, isCompanionId, lowestFreeVariant, pickFree } from "./roster";
import { cleanEmoteText } from "./emoteText";
import { companionSpot, petSpotValid } from "./tableLayout";
import { glimmersLeft, pickLanding, showMs, treatDef, VEND_HOLD_MS, type TreatShowSpec } from "./treats";
import { environmentLabel, resolveScene, tableStyleLabel } from "./scene";

export interface RoomDeps {
  now: () => number;
  rng: Rng;
}

export interface ImportResult {
  name: string;
  source: string;
  cards: CardData[];
  pool: string[];
  notFound: string[];
  warnings: string[];
  basics: Partial<Record<BasicLand, string>>;
}

export interface HandleResult {
  /** Room state changed: persist and broadcast fresh views. */
  changed: boolean;
  /** Messages that don't touch persistent state (drag previews, errors). */
  outbound: ({ to: "others" | "self"; msg: ServerMessage } | { to: "player"; playerId: string; msg: ServerMessage })[];
  /** Host asked to import a cube; the DO does the network part and calls applyImport. */
  importSource?: string;
}

export class RoomError extends Error {}

/** Joining a game in progress without a valid seat secret: the player must pick an empty seat. */
export class SeatClaimNeeded extends RoomError {
  constructor(public seats: { id: string; name: string; avatar?: string }[]) {
    super("This game has already started. Pick your seat to rejoin.");
  }
}

export interface JoinOptions {
  playerId?: string;
  secret?: string;
  name?: string;
  /** Avatar and companion the player chose earlier (ids). Without them, a human starts with neither. */
  avatar?: string;
  companion?: string;
  /** Take over this disconnected seat (trust-based rejoin from a new device or browser). */
  claim?: string;
}

/** Minimum gap between two table pings ("point" messages) from the same player. */
export const PING_COOLDOWN_MS = 300;
/** Minimum gap between two companion pokes from the same player (a little under the client's own 300 ms throttle). */
export const POKE_COOLDOWN_MS = 250;
/** Minimum gap between two emotes from the same player (a little under the client's own 1.5 s cooldown). */
export const EMOTE_COOLDOWN_MS = 1200;

const BOT_NAMES = ["Ava", "Blix", "Cogsworth", "Dross", "Echo", "Fizz", "Gloom", "Hex"];

/** Who a room belongs to: an invite (kept until deleted) or the public pool (closes at `expiresAt`). */
export interface RoomOwner {
  inviteId?: string;
  expiresAt?: number;
}

export function createRoomState(code: string, now: number, owner: RoomOwner = {}): RoomState {
  return {
    code,
    createdAt: now,
    ...(owner.inviteId ? { inviteId: owner.inviteId } : {}),
    ...(owner.expiresAt ? { expiresAt: owner.expiresAt, idleSince: now } : {}),
    phase: "lobby",
    players: [],
    secrets: {},
    config: structuredClone(DEFAULT_CONFIG),
    cube: null,
    importStatus: { state: "idle" },
    instances: {},
    nextId: 1,
    draft: null,
    decks: {},
    table: null,
  };
}

export class Room {
  /** Last ping per player (not persisted — it only throttles spam). */
  private lastPing = new Map<string, number>();
  private lastPoke = new Map<string, number>();
  private lastEmote = new Map<string, number>();
  /**
   * Who is browsing the Treatomancer's menu, until when. In memory only: a hold lost to a restart just ends (a
   * purchase doesn't need one). The show it leads to is stored instead (RoomState.treatShowUntil).
   */
  private vend: { by: string; until: number } | null = null;

  constructor(
    public state: RoomState,
    public cards: CardMap,
    private deps: RoomDeps,
  ) {
    // Games saved before stand-in ids existed get them now.
    if (state.table) syncStandIns(state.table, deps.rng);
    this.normalizeLooks();
    // Rooms saved before draft styles existed get the new settings' defaults.
    state.config.draft = normalizeDraftConfig(state.config.draft);
  }

  /** Tidies looks after loading a saved room: drops retired ids, deals bots theirs, and sorts out variants. */
  private normalizeLooks() {
    for (const p of this.state.players) {
      if (p.avatar && !isAvatarId(p.avatar)) delete p.avatar;
      if (p.companion && !isCompanionId(p.companion)) delete p.companion;
      if (p.isBot) Object.assign(p, this.dealLook(p));
    }
    for (const p of this.state.players) {
      this.setVariant(p, "avatar");
      this.setVariant(p, "companion");
    }
  }

  /** Gives a bot a random avatar and companion, preferring ones nobody holds yet. */
  private dealLook(except?: Player): { avatar: string; companion: string } {
    const others = this.state.players.filter((p) => p !== except);
    return {
      avatar: except?.avatar ?? pickFree(AVATAR_IDS, new Set(others.map((p) => p.avatar ?? "")), this.deps.rng),
      companion: except?.companion ?? pickFree(COMPANION_IDS, new Set(others.map((p) => p.companion ?? "")), this.deps.rng),
    };
  }

  /**
   * Players may share an avatar or companion; whoever holds it second (or third...) gets a different
   * colour variant so they can be told apart. The lowest variant nobody else holds is used.
   */
  private setVariant(p: Player, field: "avatar" | "companion") {
    const key = field === "avatar" ? "avatarVariant" : "companionVariant";
    if (!p[field]) {
      delete p[key];
      return;
    }
    const used = this.state.players.filter((o) => o !== p && o[field] === p[field]).map((o) => o[key] ?? 0);
    const mine = p[key];
    if (mine === undefined || used.includes(mine)) p[key] = lowestFreeVariant(used);
  }

  // --- helpers --------------------------------------------------------------------------------

  private nextId = (prefix: string) => `${prefix}${(this.state.nextId++).toString(36)}`;

  private player(id: string): Player | undefined {
    return this.state.players.find((p) => p.id === id);
  }

  private humans(): Player[] {
    return this.state.players.filter((p) => !p.isBot);
  }

  private names(): Record<string, string> {
    return Object.fromEntries(this.state.players.map((p) => [p.id, p.name]));
  }

  private draftEnv(): DraftEnv {
    return {
      config: this.state.config.draft,
      cards: this.cards,
      instances: this.state.instances,
      rng: this.deps.rng,
      now: this.deps.now(),
      nextId: this.nextId,
    };
  }

  private tableEnv(): TableEnv {
    return { cards: this.cards, rng: this.deps.rng, now: this.deps.now(), nextId: this.nextId, names: this.names() };
  }

  private requireHost(playerId: string) {
    if (!this.player(playerId)?.isHost) throw new RoomError("Only the host can do that.");
  }

  private requirePhase(phase: RoomState["phase"]) {
    if (this.state.phase !== phase) throw new RoomError(`That only works during ${phase}.`);
  }

  startBlocker(): string | null {
    const seats = this.state.players.length;
    if (seats === 0) return "Waiting for players.";
    if (!this.state.cube) return "The host needs to import a cube.";
    return validatePool(poolStats(this.state.cube.pool, this.cards), seats, this.state.config.draft);
  }

  // --- membership -----------------------------------------------------------------------------

  join(opts: JoinOptions): { playerId: string; secret: string } {
    const existing = opts.playerId ? this.player(opts.playerId) : undefined;
    if (existing && !existing.isBot && this.state.secrets[existing.id] === opts.secret) {
      existing.connected = true;
      this.syncPresence();
      return { playerId: existing.id, secret: opts.secret! };
    }
    if (this.state.phase !== "lobby") return this.claimSeat(opts.claim);
    if (this.humans().length >= MAX_HUMANS) throw new RoomError(`This lobby is full (${MAX_HUMANS} players max).`);
    if (this.state.players.length >= MAX_SEATS) throw new RoomError("This lobby is full.");

    const playerId = this.nextId("u");
    const secret = Array.from({ length: 4 }, () => randomCode(this.deps.rng, 8)).join("");
    const humanCount = this.humans().length;
    const player: Player = {
      id: playerId,
      name: (opts.name ?? "").trim().slice(0, 24) || `Player ${humanCount + 1}`,
      isBot: false,
      isHost: humanCount === 0,
      ready: false,
      connected: true,
      joinedAt: this.deps.now(),
      ...(opts.avatar && isAvatarId(opts.avatar) ? { avatar: opts.avatar } : {}),
      ...(opts.companion && isCompanionId(opts.companion) ? { companion: opts.companion } : {}),
    };
    // Humans sit before bots so friends are next to each other.
    const firstBot = this.state.players.findIndex((p) => p.isBot);
    if (firstBot >= 0) this.state.players.splice(firstBot, 0, player);
    else this.state.players.push(player);
    this.state.secrets[playerId] = secret;
    this.setVariant(player, "avatar");
    this.setVariant(player, "companion");
    this.syncPresence();
    return { playerId, secret };
  }

  /** Humans whose seat nobody is using right now: the seats a late (re)joiner may take over. */
  claimableSeats(): { id: string; name: string; avatar?: string }[] {
    return this.humans()
      .filter((p) => !p.connected)
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }));
  }

  private claimSeat(claim: string | undefined): { playerId: string; secret: string } {
    const seats = this.claimableSeats();
    if (!claim) {
      if (seats.length === 0) throw new RoomError("This game has already started and every seat is in use.");
      throw new SeatClaimNeeded(seats);
    }
    const player = this.player(claim);
    if (!player || player.isBot) throw new RoomError("That seat doesn't exist.");
    if (player.connected) throw new RoomError(`Someone is already playing as ${player.name}.`);
    // Trust-based: whoever picks a free seat gets it. A fresh secret means the old device's copy
    // no longer works, so one seat can't be driven from two places.
    const secret = Array.from({ length: 4 }, () => randomCode(this.deps.rng, 8)).join("");
    this.state.secrets[player.id] = secret;
    player.connected = true;
    this.syncPresence();
    return { playerId: player.id, secret };
  }

  setConnected(playerId: string, connected: boolean): boolean {
    const p = this.player(playerId);
    if (!p || p.connected === connected) return false;
    p.connected = connected;
    // Someone who drops out while browsing the Treatomancer lets go of it (everyone sees that in the next view).
    if (!connected && this.vend?.by === playerId) this.vend = null;
    // A host who leaves the lobby hands the crown to the next connected human.
    if (!connected && p.isHost && this.state.phase === "lobby") {
      const next = this.humans().find((h) => h.connected && h.id !== p.id);
      if (next) {
        p.isHost = false;
        next.isHost = true;
      }
    }
    this.syncPresence();
    return true;
  }

  /**
   * Marks exactly the given humans as connected (used when a room wakes up and its sockets may
   * have been dropped without close events, e.g. after a deploy). Returns true if anything changed.
   */
  syncConnections(connected: Set<string>): boolean {
    let changed = false;
    for (const p of this.humans()) changed = this.setConnected(p.id, connected.has(p.id)) || changed;
    return this.syncPresence() || changed;
  }

  /** Keeps the pick clock and the public-room idle timer in line with who's connected. */
  private syncPresence(): boolean {
    const clock = this.syncDraftClock();
    return this.syncIdle() || clock;
  }

  /** Public rooms: starts the idle countdown when the last human leaves, clears it when one is back. */
  private syncIdle(): boolean {
    if (this.state.expiresAt === undefined) return false;
    const anyoneHere = this.humans().some((p) => p.connected);
    const idleSince = anyoneHere ? null : (this.state.idleSince ?? this.deps.now());
    if (idleSince === this.state.idleSince) return false;
    this.state.idleSince = idleSince;
    return true;
  }

  /**
   * When this public room closes for good: its hard expiry, or sooner if nobody has been connected
   * for PUBLIC_LIMITS.idleMs. Null for rooms that don't expire (invite rooms, solo).
   */
  closeAt(): number | null {
    const { expiresAt, idleSince } = this.state;
    if (expiresAt === undefined) return null;
    return idleSince == null ? expiresAt : Math.min(expiresAt, idleSince + PUBLIC_LIMITS.idleMs);
  }

  /** Pick timers only run while at least one human is here, so an abandoned draft waits for you. */
  private syncDraftClock(): boolean {
    const draft = this.state.draft;
    if (this.state.phase !== "drafting" || !draft) return false;
    const anyoneHere = this.humans().some((p) => p.connected);
    return anyoneHere ? resumeClock(draft, this.deps.now()) : pauseClock(draft, this.deps.now());
  }

  // --- messages -------------------------------------------------------------------------------

  handle(playerId: string, msg: ClientMessage): HandleResult {
    const result: HandleResult = { changed: false, outbound: [] };
    try {
      this.dispatch(playerId, msg, result);
    } catch (err) {
      if (err instanceof RoomError || err instanceof DraftError || err instanceof TableError) {
        result.outbound.push({ to: "self", msg: { t: "error", message: err.message } });
        return result;
      }
      throw err;
    }
    return result;
  }

  private dispatch(playerId: string, msg: ClientMessage, result: HandleResult) {
    const me = this.player(playerId);
    if (!me) throw new RoomError("You're not in this room.");

    switch (msg.t) {
      case "ping":
        result.outbound.push({ to: "self", msg: { t: "pong" } });
        return;

      case "setName": {
        me.name = msg.name;
        result.changed = true;
        return;
      }

      case "setLook": {
        this.requirePhase("lobby");
        for (const field of ["avatar", "companion"] as const) {
          const value = msg[field];
          if (value === undefined) continue;
          // A new companion starts at its home spot (the old one's spot was its own).
          if (field === "companion" && value !== me.companion) delete me.companionAt;
          if (value === null) delete me[field];
          else me[field] = value;
          delete me[field === "avatar" ? "avatarVariant" : "companionVariant"];
          this.setVariant(me, field);
        }
        result.changed = true;
        return;
      }

      case "setReady": {
        this.requirePhase("lobby");
        me.ready = msg.ready;
        result.changed = true;
        this.maybeStartDraft();
        return;
      }

      case "config": {
        this.requireHost(playerId);
        this.requirePhase("lobby");
        const next: LobbyConfig = {
          draft: normalizeDraftConfig({ ...this.state.config.draft, ...msg.draft }),
          game: { ...this.state.config.game, ...msg.game },
        };
        if (next.draft.cardsPerPack < 2 || next.draft.cardsPerPack > 30) throw new RoomError("Packs need between 2 and 30 cards.");
        this.state.config = next;
        this.unreadyAll();
        result.changed = true;
        return;
      }

      case "import": {
        this.requireHost(playerId);
        this.requirePhase("lobby");
        if (this.state.importStatus.state === "running") throw new RoomError("An import is already running.");
        this.state.importStatus = { state: "running", message: "Starting import…" };
        result.changed = true;
        result.importSource = msg.source;
        return;
      }

      case "addBot": {
        this.requireHost(playerId);
        this.requirePhase("lobby");
        if (this.state.players.length >= MAX_SEATS) throw new RoomError(`At most ${MAX_SEATS} seats (including bots).`);
        const used = new Set(this.state.players.map((p) => p.name));
        const name = BOT_NAMES.map((n) => `Bot ${n}`).find((n) => !used.has(n)) ?? `Bot ${this.state.players.length + 1}`;
        const bot: Player = { id: this.nextId("bot"), name, isBot: true, isHost: false, ready: true, connected: true, joinedAt: this.deps.now(), ...this.dealLook() };
        this.state.players.push(bot);
        this.setVariant(bot, "avatar");
        this.setVariant(bot, "companion");
        result.changed = true;
        this.maybeStartDraft();
        return;
      }

      case "kick": {
        this.requireHost(playerId);
        this.requirePhase("lobby");
        if (msg.playerId === playerId) throw new RoomError("You can't remove yourself.");
        this.state.players = this.state.players.filter((p) => p.id !== msg.playerId);
        delete this.state.secrets[msg.playerId];
        result.changed = true;
        this.maybeStartDraft();
        return;
      }

      case "pick": {
        this.requirePhase("drafting");
        const draft = this.state.draft!;
        const env = this.draftEnv();
        makePick(draft, seatOf(draft, playerId), msg.packId, msg.picks, msg.burns, env);
        this.advanceDraft();
        result.changed = true;
        return;
      }

      case "deck": {
        this.requirePhase("deckbuilding");
        const picks = this.state.draft?.picks[playerId] ?? [];
        const given = [...msg.main, ...msg.side];
        const pickSet = new Set(picks);
        if (given.length !== picks.length || new Set(given).size !== given.length || !given.every((iid) => pickSet.has(iid))) {
          throw new RoomError("Deck doesn't match your drafted cards.");
        }
        const deck = this.state.decks[playerId];
        deck.main = msg.main;
        deck.side = msg.side;
        deck.basics = msg.basics;
        if (deckSize(deck) < this.state.config.game.minDeckSize) deck.ready = false;
        result.changed = true;
        return;
      }

      case "deckReady": {
        this.requirePhase("deckbuilding");
        const deck = this.state.decks[playerId];
        const min = this.state.config.game.minDeckSize;
        if (msg.ready && deckSize(deck) < min) throw new RoomError(`Your deck needs at least ${min} cards.`);
        deck.ready = msg.ready;
        result.changed = true;
        this.maybeStartGame();
        return;
      }

      case "table": {
        this.requirePhase("playing");
        const table = this.state.table!;
        applyTableAction(table, playerId, resolveTableAction(table, playerId, msg.action), this.tableEnv());
        result.changed = true;
        return;
      }

      case "drag": {
        const table = this.state.table;
        if (this.state.phase !== "playing" || !table) return;
        let card;
        try {
          card = table.cards[realIdsFor(table, playerId)(msg.id)];
        } catch {
          return;
        }
        // Each player gets the id they know the card by. A card pulled out of a hand (only ever the
        // sender's own) goes out without one: which card of the hand it is would give it away.
        if (card.zone !== "battlefield" && (card.zone !== "hand" || card.owner !== playerId)) return;
        for (const pid of table.seats) {
          if (pid === playerId) continue;
          const id = card.zone === "hand" ? handDragId(card.owner) : shownId(table, pid, card.id);
          result.outbound.push({ to: "player", playerId: pid, msg: { t: "drag", by: playerId, id, x: msg.x, y: msg.y } });
        }
        return;
      }

      case "point": {
        if (this.state.phase !== "playing") return;
        const now = this.deps.now();
        if (now - (this.lastPing.get(playerId) ?? -Infinity) < PING_COOLDOWN_MS) return;
        this.lastPing.set(playerId, now);
        result.outbound.push({ to: "others", msg: { t: "point", by: playerId, x: msg.x, y: msg.y } });
        return;
      }

      case "poke": {
        // Cosmetic and ephemeral, like a ping: relayed, never stored. Only a companion that's on the table can be poked.
        const table = this.state.table;
        if (this.showing() || this.state.phase !== "playing" || !table || !table.seats.includes(msg.target) || !this.player(msg.target)?.companion) return;
        const now = this.deps.now();
        if (now - (this.lastPoke.get(playerId) ?? -Infinity) < POKE_COOLDOWN_MS) return;
        this.lastPoke.set(playerId, now);
        result.outbound.push({ to: "others", msg: { t: "poke", by: playerId, target: msg.target, step: msg.step } });
        return;
      }

      case "emote": {
        // Also cosmetic and ephemeral: the sender's own companion, so they must be at the table with one.
        if (!this.atTableWithCompanion(playerId) || this.showing()) return;
        // A player's own line is cleaned here too (the sender's tab can't be trusted to have); text that doesn't
        // survive drops the whole emote, before it can use up the cooldown.
        const text = msg.text === undefined ? undefined : cleanEmoteText(msg.text);
        if (text === null) return;
        const now = this.deps.now();
        if (now - (this.lastEmote.get(playerId) ?? -Infinity) < EMOTE_COOLDOWN_MS) return;
        this.lastEmote.set(playerId, now);
        result.outbound.push({ to: "others", msg: { t: "emote", by: playerId, slot: msg.slot, ...(text !== undefined && { text }) } });
        return;
      }

      case "petMove":
      case "petCancel": {
        // Carrying your own companion around: relayed like a drag, never stored.
        if (!this.atTableWithCompanion(playerId) || this.showing()) return;
        const out: ServerMessage = msg.t === "petMove" ? { t: "petMove", by: playerId, x: msg.x, y: msg.y } : { t: "petCancel", by: playerId };
        result.outbound.push({ to: "others", msg: out });
        return;
      }

      case "setPetPos": {
        // Putting it down: the one companion change that's stored (one write per drop), so reloads and late
        // joiners see it where it was left. Only ever the sender's own, and only somewhere it may stand (on the
        // table, off everyone else's mat).
        if (!this.atTableWithCompanion(playerId)) throw new RoomError("You have no companion at the table.");
        if (this.showing()) throw new RoomError("Hold on, the companions are chasing a treat!");
        if (msg.at === null) {
          if (!me.companionAt) return;
          delete me.companionAt;
        } else {
          const seats = this.state.table!.seats;
          if (!petSpotValid(msg.at, seats.length, seats.indexOf(playerId))) throw new RoomError("Your companion can't stand there.");
          me.companionAt = { x: Math.round(msg.at.x * 100) / 100, y: Math.round(msg.at.y * 100) / 100 };
        }
        result.outbound.push({ to: "others", msg: { t: "petLand", by: playerId, at: me.companionAt ?? null } });
        result.changed = true;
        return;
      }

      case "scene": {
        // Anyone at the table may change it, for everyone. Cosmetic: nothing on the table moves.
        this.requirePhase("playing");
        const table = this.state.table!;
        if (!table.seats.includes(playerId)) throw new RoomError("You're not seated at this table.");
        const cur = resolveScene(this.state.scene);
        const next = { table: msg.table ?? cur.table, env: msg.env ?? cur.env };
        if (next.table === cur.table && next.env === cur.env) return;
        this.state.scene = next;
        logSceneChange(
          table,
          playerId,
          { table: next.table !== cur.table ? tableStyleLabel(next.table) : undefined, env: next.env !== cur.env ? environmentLabel(next.env) : undefined },
          this.tableEnv(),
        );
        result.changed = true;
        return;
      }

      case "vend": {
        this.requirePhase("playing");
        if (!this.state.table!.seats.includes(playerId)) throw new RoomError("You're not seated at this table.");
        const now = this.deps.now();
        const holder = this.vendHolder();
        const tell = (msg: ServerMessage) => {
          result.outbound.push({ to: "self", msg });
          result.outbound.push({ to: "others", msg });
        };
        if (!msg.open) {
          if (holder?.by !== playerId) return;
          this.vend = null;
          tell({ t: "vend", by: null });
          return;
        }
        if (this.showing() || (holder && holder.by !== playerId)) {
          // Someone beat them to it: tell them who (their screen may not know yet), and why not.
          result.outbound.push({ to: "self", msg: holder ? { t: "vend", by: holder.by, until: holder.until } : { t: "vend", by: null } });
          throw new RoomError(holder ? `${this.player(holder.by)?.name ?? "Someone"} is browsing the Treatomancer.` : "The Treatomancer is busy. Wait for the treat to be gobbled.");
        }
        this.vend = { by: playerId, until: now + VEND_HOLD_MS };
        tell({ t: "vend", by: playerId, until: this.vend.until });
        return;
      }

      case "treat": {
        // Bought with stored glimmers (one write), then a show that's played everywhere and never stored.
        this.requirePhase("playing");
        const table = this.state.table!;
        if (!table.seats.includes(playerId)) throw new RoomError("You're not seated at this table.");
        const holder = this.vendHolder();
        if (this.showing()) throw new RoomError("Wait for the last treat to be gobbled first.");
        if (holder && holder.by !== playerId) throw new RoomError(`${this.player(holder.by)?.name ?? "Someone"} is browsing the Treatomancer.`);
        const treat = treatDef(msg.treat)!;
        const tp = table.players[playerId];
        const left = glimmersLeft(tp);
        if (left < treat.cost) throw new RoomError("Not enough glimmers for that one.");
        tp.glimmers = left - treat.cost;
        const n = table.seats.length;
        const racers = table.seats.flatMap((pid, seat) => {
          const p = this.player(pid);
          if (!p?.companion) return [];
          const at = p.companionAt ?? companionSpot(seat, n);
          return [{ id: pid, companion: p.companion, x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 }];
        });
        const show: TreatShowSpec = { by: playerId, treat: treat.id, seed: Math.floor(this.deps.rng() * 2 ** 31), at: pickLanding(n, this.deps.rng), racers };
        this.vend = null;
        this.state.treatShowUntil = this.deps.now() + showMs(show) + 300;
        logTreat(table, playerId, treat.name, treat.cost, this.tableEnv());
        result.outbound.push({ to: "self", msg: { t: "treat", show } });
        result.outbound.push({ to: "others", msg: { t: "treat", show } });
        result.changed = true;
        return;
      }

      case "debug": {
        this.debug(playerId, msg.cmd);
        result.changed = true;
        return;
      }
    }
  }

  /** Who holds the Treatomancer, if anyone still does (a hold runs out after VEND_HOLD_MS). */
  private vendHolder(): { by: string; until: number } | null {
    if (this.vend && (this.vend.until <= this.deps.now() || this.state.phase !== "playing")) this.vend = null;
    return this.vend;
  }

  /** Whether a treat show is playing (the companions are busy). */
  private showing(): boolean {
    return this.state.phase === "playing" && (this.state.treatShowUntil ?? 0) > this.deps.now();
  }

  /** Whether a player is seated at the table with a companion (so it's on the table, theirs to move or emote with). */
  private atTableWithCompanion(playerId: string): boolean {
    const table = this.state.table;
    return this.state.phase === "playing" && !!table && table.seats.includes(playerId) && !!this.player(playerId)?.companion;
  }

  /** Every companion back to its home spot: a new game (or the lobby) starts the table afresh. */
  private sendPetsHome() {
    for (const p of this.state.players) delete p.companionAt;
  }

  private unreadyAll() {
    for (const p of this.state.players) if (!p.isBot) p.ready = false;
  }

  applyImport(res: ImportResult): void {
    for (const id of Object.keys(this.cards)) delete this.cards[id];
    for (const card of res.cards) this.cards[card.id] = card;
    this.state.cube = {
      name: res.name,
      source: res.source,
      pool: res.pool,
      notFound: res.notFound,
      warnings: res.warnings,
      importedAt: this.deps.now(),
      basics: res.basics,
    };
    this.state.importStatus = { state: "idle" };
    this.unreadyAll();
  }

  failImport(message: string): void {
    this.state.importStatus = { state: "error", message };
  }

  setImportProgress(message: string): void {
    this.state.importStatus = { state: "running", message };
  }

  // --- phase transitions ----------------------------------------------------------------------

  private maybeStartDraft() {
    if (this.state.phase !== "lobby") return;
    const humans = this.humans();
    if (humans.length === 0 || !humans.every((p) => p.ready)) return;
    if (this.startBlocker()) return;
    this.startDraft();
  }

  startDraft() {
    const seats = this.state.players.map((p) => p.id);
    this.state.instances = {};
    this.state.draft = createDraft(seats, this.state.cube!.pool, this.draftEnv());
    this.state.phase = "drafting";
    this.state.decks = {};
    this.state.table = null;
    this.sendPetsHome();
    this.advanceDraft();
  }

  private isBotSeat = (seat: number) => this.player(this.state.draft!.seats[seat])?.isBot ?? true;

  private advanceDraft() {
    const draft = this.state.draft!;
    advance(draft, this.isBotSeat, this.draftEnv());
    if (draft.done) this.startDeckbuilding();
  }

  private startDeckbuilding() {
    this.state.phase = "deckbuilding";
    this.state.decks = {};
    for (const p of this.humans()) this.state.decks[p.id] = newDeck(this.state.draft!.picks[p.id] ?? []);
  }

  private maybeStartGame() {
    const humans = this.humans();
    if (humans.every((p) => this.state.decks[p.id]?.ready)) this.startGame();
  }

  private startGame() {
    const seats = this.state.draft!.seats.filter((id) => !this.player(id)?.isBot);
    this.state.table = createTable(seats, this.state.decks, this.state.instances, this.state.cube?.basics ?? {}, this.state.config.game, this.tableEnv());
    this.state.phase = "playing";
    this.sendPetsHome();
  }

  /** Auto-picks timed-out seats. Returns true if state changed. */
  tick(): boolean {
    if (this.state.phase !== "drafting" || !this.state.draft) return false;
    const changed = advance(this.state.draft, this.isBotSeat, this.draftEnv());
    if (this.state.draft.done) this.startDeckbuilding();
    return changed;
  }

  nextAlarm(): number | null {
    if (this.state.phase !== "drafting" || !this.state.draft) return null;
    return nextDeadline(this.state.draft);
  }

  private debug(playerId: string, cmd: DebugCommand) {
    switch (cmd) {
      case "autoPickMe": {
        this.requirePhase("drafting");
        const draft = this.state.draft!;
        autoPick(draft, seatOf(draft, playerId), this.draftEnv());
        this.advanceDraft();
        return;
      }
      case "finishDraft": {
        if (this.state.phase === "lobby") {
          if (this.startBlocker()) throw new RoomError(this.startBlocker()!);
          this.startDraft();
        }
        this.requirePhase("drafting");
        advance(this.state.draft!, () => true, this.draftEnv());
        this.startDeckbuilding();
        return;
      }
      case "autoBuildMe": {
        this.requirePhase("deckbuilding");
        const picks = this.state.draft!.picks[playerId] ?? [];
        this.state.decks[playerId] = autoBuild(picks, this.state.instances, this.cards, this.state.config.game.minDeckSize);
        return;
      }
      case "startGame": {
        if (this.state.phase === "lobby" || this.state.phase === "drafting") this.debug(playerId, "finishDraft");
        this.requirePhase("deckbuilding");
        for (const p of this.humans()) {
          const deck = this.state.decks[p.id];
          if (!deck.ready || deckSize(deck) < this.state.config.game.minDeckSize) {
            this.state.decks[p.id] = { ...autoBuild(this.state.draft!.picks[p.id] ?? [], this.state.instances, this.cards, this.state.config.game.minDeckSize), ready: true };
          }
        }
        this.startGame();
        return;
      }
      case "toLobby": {
        this.state.phase = "lobby";
        this.state.draft = null;
        this.state.decks = {};
        this.state.table = null;
        this.state.instances = {};
        this.sendPetsHome();
        this.unreadyAll();
        return;
      }
    }
  }

  // --- views ----------------------------------------------------------------------------------

  /** What the "My rooms" list shows for this room. */
  summary(): RoomSummary {
    return {
      phase: this.state.phase,
      players: this.humans().map((p) => p.name),
      bots: this.state.players.length - this.humans().length,
      cubeName: this.state.cube?.name ?? null,
      cardCount: this.state.cube?.pool.length ?? 0,
    };
  }

  cubeSummary(): CubeSummary | null {
    const cube = this.state.cube;
    if (!cube) return null;
    return {
      name: cube.name,
      source: cube.source,
      size: cube.pool.length,
      uniqueCards: new Set(cube.pool).size,
      stats: poolStats(cube.pool, this.cards),
      notFound: cube.notFound,
      warnings: cube.warnings,
      importedAt: cube.importedAt,
    };
  }

  private draftView(viewer: string): DraftView | null {
    const draft = this.state.draft;
    if (!draft || this.state.phase !== "drafting") return null;
    const seat = seatOf(draft, viewer);
    const pack = seat >= 0 ? draft.queues[seat][0] : undefined;
    const config = this.state.config.draft;
    const left = config.passPattern === "left" || draft.round % 2 === 0;
    return {
      round: draft.round,
      packsPerPlayer: config.packsPerPlayer,
      cardsPerPack: config.cardsPerPack,
      seat,
      seats: draft.seats.map((id, s) => {
        const p = this.player(id);
        const queue = draft.queues[s];
        return { playerId: id, name: p?.name ?? "?", isBot: p?.isBot ?? true, queued: queue.length, packCards: queue[0]?.cards.length ?? 0, picks: draft.picks[id]?.length ?? 0 };
      }),
      pack: pack ? { id: pack.id, cards: pack.cards.slice(), picksTaken: pack.picksTaken, round: pack.round, deadline: pack.deadline } : null,
      need: pack ? turnCounts(pack, config) : { picks: 0, burns: 0 },
      passDirection: left ? "left" : "right",
      picks: draft.picks[viewer] ?? [],
      done: draft.done,
    };
  }

  viewFor(viewer: string): RoomView {
    const draft = this.draftView(viewer);
    const deck: DeckState | null = this.state.decks[viewer] ?? null;
    const visible = new Set<string>([...(draft?.pack?.cards ?? []), ...(draft?.picks ?? []), ...(deck ? [...deck.main, ...deck.side] : [])]);
    const instances: Record<string, CardInstance> = {};
    for (const iid of visible) if (this.state.instances[iid]) instances[iid] = this.state.instances[iid];

    return {
      code: this.state.code,
      phase: this.state.phase,
      you: viewer,
      players: this.state.players,
      config: this.state.config,
      cube: this.cubeSummary(),
      importStatus: this.state.importStatus,
      startBlocker: this.startBlocker(),
      draft,
      deck,
      deckStatus: Object.fromEntries(Object.entries(this.state.decks).map(([id, d]) => [id, { ready: d.ready, size: deckSize(d) }])),
      basicIds: this.state.cube?.basics ?? {},
      instances,
      table: this.state.table ? tableViewFor(this.state.table, viewer) : null,
      scene: resolveScene(this.state.scene),
      vend: this.vendHolder(),
      showUntil: this.showing() ? this.state.treatShowUntil! : null,
      expiresAt: this.state.expiresAt ?? null,
      serverNow: this.deps.now(),
    };
  }
}
