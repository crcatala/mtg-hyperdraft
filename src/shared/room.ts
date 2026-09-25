// The whole game room as a pure state machine: lobby → drafting → deckbuilding → playing.
// The Durable Object wraps this with sockets, persistence and alarms; tests drive it directly.

import type { ClientMessage, CubeSummary, DebugCommand, DraftView, RoomView, ServerMessage } from "./protocol";
import type { CardData, CardInstance, CardMap, DeckState, LobbyConfig, Player, RoomState, BasicLand } from "./types";
import { DEFAULT_CONFIG, MAX_HUMANS, MAX_SEATS } from "./types";
import { advance, autoPick, createDraft, DraftError, makePick, nextDeadline, seatOf, turnCounts, validatePool, type DraftEnv } from "./draft";
import { autoBuild, deckSize, newDeck } from "./deck";
import { applyTableAction, createTable, TableError, tableViewFor, type TableEnv } from "./table";
import { randomCode, type Rng } from "./rng";

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
  outbound: { to: "others" | "self"; msg: ServerMessage }[];
  /** Host asked to import a cube; the DO does the network part and calls applyImport. */
  importSource?: string;
}

export class RoomError extends Error {}

const BOT_NAMES = ["Ava", "Blix", "Cogsworth", "Dross", "Echo", "Fizz", "Gloom", "Hex"];

export function createRoomState(code: string, now: number): RoomState {
  return {
    code,
    createdAt: now,
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
  constructor(
    public state: RoomState,
    public cards: CardMap,
    private deps: RoomDeps,
  ) {}

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
    return validatePool(this.state.cube.pool.length, seats, this.state.config.draft);
  }

  // --- membership -----------------------------------------------------------------------------

  join(opts: { playerId?: string; secret?: string; name?: string }): { playerId: string; secret: string } {
    const existing = opts.playerId ? this.player(opts.playerId) : undefined;
    if (existing && !existing.isBot && this.state.secrets[existing.id] === opts.secret) {
      existing.connected = true;
      return { playerId: existing.id, secret: opts.secret! };
    }
    if (this.state.phase !== "lobby") throw new RoomError("This game has already started.");
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
    };
    // Humans sit before bots so friends are next to each other.
    const firstBot = this.state.players.findIndex((p) => p.isBot);
    if (firstBot >= 0) this.state.players.splice(firstBot, 0, player);
    else this.state.players.push(player);
    this.state.secrets[playerId] = secret;
    return { playerId, secret };
  }

  setConnected(playerId: string, connected: boolean): boolean {
    const p = this.player(playerId);
    if (!p || p.connected === connected) return false;
    p.connected = connected;
    // A host who leaves the lobby hands the crown to the next connected human.
    if (!connected && p.isHost && this.state.phase === "lobby") {
      const next = this.humans().find((h) => h.connected && h.id !== p.id);
      if (next) {
        p.isHost = false;
        next.isHost = true;
      }
    }
    return true;
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
          draft: { ...this.state.config.draft, ...msg.draft },
          game: { ...this.state.config.game, ...msg.game },
        };
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
        this.state.players.push({ id: this.nextId("bot"), name, isBot: true, isHost: false, ready: true, connected: true, joinedAt: this.deps.now() });
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
        applyTableAction(this.state.table!, playerId, msg.action, this.tableEnv());
        result.changed = true;
        return;
      }

      case "drag": {
        if (this.state.phase !== "playing") return;
        result.outbound.push({ to: "others", msg: { t: "drag", by: playerId, id: msg.id, x: msg.x, y: msg.y } });
        return;
      }

      case "debug": {
        this.debug(playerId, msg.cmd);
        result.changed = true;
        return;
      }
    }
  }

  private unreadyAll() {
    for (const p of this.state.players) if (!p.isBot) p.ready = false;
  }

  applyImport(res: ImportResult): void {
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
        this.unreadyAll();
        return;
      }
    }
  }

  // --- views ----------------------------------------------------------------------------------

  cubeSummary(): CubeSummary | null {
    const cube = this.state.cube;
    if (!cube) return null;
    return {
      name: cube.name,
      source: cube.source,
      size: cube.pool.length,
      uniqueCards: new Set(cube.pool).size,
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
        return { playerId: id, name: p?.name ?? "?", isBot: p?.isBot ?? true, queued: draft.queues[s].length, picks: draft.picks[id]?.length ?? 0 };
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
      serverNow: this.deps.now(),
    };
  }
}
