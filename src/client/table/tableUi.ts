// Table-only UI state + action helpers shared by the 3D scene and the DOM overlay.

import { create } from "zustand";
import type { TableAction } from "../../shared/table";
import type { TableCard, TableState, ZoneName } from "../../shared/types";
import { useStore, type MenuItem } from "../store";
import { hasBackFace, nextFace } from "../cardStyle";
import { sfx } from "../sfx";
import { pilePosition } from "../../shared/tableLayout";
export { seatsFromMe } from "../../shared/tableLayout";
import { guardForAll, type GuardContext } from "./guards";

export interface LocalDrag {
  ids: string[];
  source: "battlefield" | "hand";
  /** Table position under the pointer. */
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  /** Offset of each dragged card from the pointer (battlefield drags keep formation). */
  offsets: Record<string, { dx: number; dy: number }>;
  overHand: boolean;
}

/** A temporary "look here!" marker on the table (Tabletop Simulator style). */
export interface Ping {
  id: number;
  by: string;
  x: number;
  y: number;
  /** performance.now() when it appeared. */
  at: number;
}

/** How long a ping stays on the table. */
export const PING_MS = 5000;

export interface AskState {
  question: string;
  kind: "number" | "text" | "confirm";
  initial?: string;
  /** Label of the OK button (confirmations name the action: "Tap", "Draw"…). */
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  /** Called when the dialog is dismissed without submitting. */
  onCancel?: () => void;
}

export interface LogZoom {
  /** Which card link it was opened from (to fly back to it). */
  key: string;
  cardId: string;
  face: number;
}

export interface ZoneViewerState {
  playerId: string;
  zone: Exclude<ZoneName, "battlefield">;
}

interface TableUi {
  selected: string[];
  hovered: string | null;
  drag: LocalDrag | null;
  viewer: ZoneViewerState | null;
  tokenDialog: boolean;
  help: boolean;
  /** Camera looking down on the whole table from above. */
  overview: boolean;
  /** Whose seat the camera sits behind (null: your own). */
  pov: string | null;
  /** A card named in the game log, open in the zoom carousel. */
  logZoom: LogZoom | null;
  logOpen: boolean;
  ask: AskState | null;
  /** Hand card under the pointer (keyboard shortcuts act on it). */
  handHover: string | null;
  /** Hand card picked with a click; clicking it again opens the zoom carousel (like the draft). */
  handSelected: string | null;
  /** Hand card the zoom carousel was opened on. */
  handZoom: string | null;
  /** Face each double-faced hand card is turned to; it enters the battlefield that way. */
  handFaces: Record<string, number>;
  /** Where dropped battlefield cards are headed until the server confirms, so they don't snap back. */
  settling: Record<string, { x: number; y: number }>;
  pings: Ping[];
  setSelected: (ids: string[]) => void;
  setHovered: (id: string | null) => void;
  setDrag: (d: LocalDrag | null) => void;
  setViewer: (v: ZoneViewerState | null) => void;
  set: (p: Partial<TableUi>) => void;
}

export const useTableUi = create<TableUi>((set) => ({
  selected: [],
  hovered: null,
  drag: null,
  viewer: null,
  tokenDialog: false,
  help: false,
  overview: false,
  pov: null,
  logZoom: null,
  logOpen: true,
  ask: null,
  handHover: null,
  handSelected: null,
  handZoom: null,
  handFaces: {},
  settling: {},
  pings: [],
  setSelected: (selected) => set({ selected }),
  setHovered: (hovered) => set({ hovered }),
  setDrag: (drag) => set({ drag }),
  setViewer: (viewer) => set({ viewer }),
  set: (p) => set(p),
}));

export interface ActOptions {
  /** The player backed out of the confirmation (e.g. put a dropped card back). */
  onCancel?: () => void;
  /** Runs once the action is actually sent (sounds, local state). */
  onSend?: () => void;
}

/** Sends table actions, first asking "are you sure?" when they're easy to do by accident (see guards). */
export function actAll(actions: TableAction[], opts: ActOptions = {}) {
  if (actions.length === 0) return;
  const send = () => {
    for (const action of actions) useStore.getState().send({ t: "table", action });
    opts.onSend?.();
  };
  const t = table();
  const guard = t ? guardForAll(actions, guardContext(t)) : null;
  if (!guard) return send();
  useTableUi.getState().set({ ask: { question: guard.question, kind: "confirm", confirmLabel: guard.confirm, onSubmit: send, onCancel: opts.onCancel } });
}

export function act(action: TableAction, opts: ActOptions = {}) {
  actAll([action], opts);
}

function guardContext(t: TableState): GuardContext {
  const players = useStore.getState().view?.players ?? [];
  return { table: t, me: me(), nameOf: (id) => players.find((p) => p.id === id)?.name ?? "another player", cardLabel };
}

export function table(): TableState | null {
  return useStore.getState().view?.table ?? null;
}

export function me(): string {
  return useStore.getState().view?.you ?? "";
}

/** Moves the camera behind a player's seat (yours when null), leaving the overhead view. */
export function viewFrom(playerId: string | null) {
  useTableUi.getState().set({ pov: playerId === me() ? null : playerId, overview: false });
}

/** The cards a keyboard shortcut applies to: hovered card, else the selection. */
export function targetIds(): string[] {
  const ui = useTableUi.getState();
  const t = table();
  if (!t) return [];
  if (ui.hovered && t.cards[ui.hovered]) {
    return ui.selected.includes(ui.hovered) ? ui.selected.filter((id) => t.cards[id]) : [ui.hovered];
  }
  return ui.selected.filter((id) => t.cards[id]);
}

export function cardLabel(card: TableCard): string {
  const cards = useStore.getState().cards;
  if (card.hidden) return "Face-down card";
  if (card.token) return `${card.token.name} (token)`;
  return card.cardId ? cards[card.cardId]?.name ?? "Card" : "Card";
}

export function moveTo(ids: string[], to: ZoneName, extra: Partial<Extract<TableAction, { a: "move" }>> = {}) {
  if (ids.length === 0) return;
  act({ a: "move", ids, to, ...extra });
}

/** Plays a card from hand, on whichever face its owner turned it to. */
export function playFromHand(id: string, extra: Partial<Extract<TableAction, { a: "move" }>> = {}) {
  const ui = useTableUi.getState();
  const face = ui.handFaces[id] ?? 0;
  if (ui.handSelected === id) ui.set({ handSelected: null });
  if (face !== 0) {
    const { [id]: _, ...rest } = ui.handFaces;
    ui.set({ handFaces: rest });
  }
  moveTo([id], "battlefield", { ...extra, ...(face !== 0 ? { face } : {}) });
}

/** Click on a hand card: the first selects it, a second click on the selected card zooms in. */
export function clickHandCard(id: string) {
  const ui = useTableUi.getState();
  if (ui.handSelected === id) ui.set({ handZoom: id });
  else ui.set({ handSelected: id });
}

/** Turns a double-faced hand card over (only in your own view until it is played). */
export function turnHandCard(id: string) {
  const card = table()?.cards[id];
  const data = card?.cardId ? useStore.getState().cards[card.cardId] : undefined;
  if (card?.zone !== "hand" || !hasBackFace(data)) return;
  const ui = useTableUi.getState();
  const face = nextFace(data, ui.handFaces[id] ?? 0);
  ui.set({ handFaces: { ...ui.handFaces, [id]: face } });
  // Keep the hover preview in sync with the face now showing.
  if (ui.handHover === id) useStore.getState().setPreview({ cardId: data!.id, face, foil: card?.foil });
}

/**
 * Remembers where dropped cards are going until the server's state catches up (or `holdMs` pass;
 * Infinity holds them until settled again or `unsettle`d, e.g. while a confirmation is open).
 */
export function settle(positions: Record<string, { x: number; y: number }>, holdMs = 1500) {
  const ui = useTableUi.getState();
  ui.set({ settling: { ...ui.settling, ...positions } });
  if (holdMs === Infinity) return;
  setTimeout(() => {
    const cur = useTableUi.getState().settling;
    const next = { ...cur };
    for (const id of Object.keys(positions)) if (next[id] === positions[id]) delete next[id];
    useTableUi.getState().set({ settling: next });
  }, holdMs);
}

/** Forgets where cards were headed (a drop the player backed out of): they ease back to their spot. */
export function unsettle(ids: string[]) {
  const ui = useTableUi.getState();
  const next = { ...ui.settling };
  for (const id of ids) delete next[id];
  ui.set({ settling: next });
}

let pingSeq = 1;
let lastPingSent = 0;

/** Shows a ping on the table (ours or someone else's); it removes itself after PING_MS. */
export function showPing(by: string, x: number, y: number) {
  const ping: Ping = { id: pingSeq++, by, x, y, at: performance.now() };
  const ui = useTableUi.getState();
  // Several pings may overlap, but keep the scene bounded.
  ui.set({ pings: [...ui.pings.slice(-11), ping] });
  const seat = table()?.seats.indexOf(by) ?? 0;
  sfx.ping(Math.max(0, seat));
  setTimeout(() => useTableUi.getState().set({ pings: useTableUi.getState().pings.filter((p) => p.id !== ping.id) }), PING_MS);
}

/** Pings a table spot for everyone. Returns false when throttled. */
export function pingAt(x: number, y: number): boolean {
  const now = performance.now();
  if (now - lastPingSent < 300) return false;
  lastPingSent = now;
  const clamp = (v: number) => Math.max(-200, Math.min(200, v));
  showPing(me(), clamp(x), clamp(y));
  useStore.getState().send({ t: "point", x: clamp(x), y: clamp(y) });
  return true;
}

export function toggleTap(ids: string[]) {
  const t = table();
  const cards = ids.map((id) => t?.cards[id]).filter((c): c is TableCard => !!c && c.zone === "battlefield");
  if (cards.length === 0) return;
  act({ a: "tap", ids: cards.map((c) => c.id), tapped: !cards[0].tapped }, { onSend: () => sfx.tap() });
}

function counterItems(id: string): MenuItem[] {
  return [
    { label: "+1/+1 counter", hint: "C", onSelect: () => act({ a: "counter", id, kind: "+1/+1", delta: 1 }) },
    { label: "−1/−1 counter", onSelect: () => act({ a: "counter", id, kind: "-1/-1", delta: 1 }) },
    { label: "Loyalty / charge counter", onSelect: () => act({ a: "counter", id, kind: "counter", delta: 1 }) },
    {
      label: "Custom counter…",
      onSelect: () =>
        useTableUi.getState().set({
          ask: { question: "Counter name (e.g. stun, lore, oil)", kind: "text", initial: "stun", onSubmit: (kind) => kind.trim() && act({ a: "counter", id, kind: kind.trim(), delta: 1 }) },
        }),
    },
  ];
}

export function battlefieldMenu(card: TableCard, x: number, y: number) {
  const ids = useTableUi.getState().selected.includes(card.id) ? targetIds() : [card.id];
  const many = ids.length > 1;
  const data = card.cardId ? useStore.getState().cards[card.cardId] : undefined;
  const counters = Object.entries(card.counters);
  const items: MenuItem[] = [
    { label: card.tapped ? "Untap" : "Tap", hint: "T / dbl-click", onSelect: () => toggleTap(ids) },
    { label: card.faceDown ? "Turn face up" : "Turn face down", hint: "F", onSelect: () => act({ a: "flip", ids }) },
    ...(hasBackFace(data) && !many ? [{ label: "Transform / flip over", hint: "R", onSelect: () => act({ a: "turnFace", id: card.id }) }] : []),
    { separator: true, label: "" },
    ...(!many ? counterItems(card.id) : []),
    ...counters.map(([kind, n]) => ({ label: `Remove ${kind} counter (${n})`, onSelect: () => act({ a: "counter", id: card.id, kind, delta: -1 }) })),
    { separator: true, label: "" },
    { label: "To hand", hint: "H", onSelect: () => moveTo(ids, "hand") },
    { label: "To graveyard", hint: "G", onSelect: () => moveTo(ids, "graveyard") },
    { label: "Exile", hint: "X", onSelect: () => moveTo(ids, "exile") },
    { label: "Top of library", onSelect: () => moveTo(ids, "library") },
    { label: "Bottom of library", onSelect: () => moveTo(ids, "library", { bottom: true }) },
    { separator: true, label: "" },
    // A face-down card can't be copied (the copy would reveal it).
    ...(!many && !card.faceDown ? [{ label: "Create token copy", onSelect: () => act({ a: "clone", id: card.id }) }] : []),
    { label: "Ping this card", icon: "pin", hint: "Tab", onSelect: () => pingAt(card.x, card.y) },
  ];
  useStore.getState().openMenu({ x, y, title: many ? `${ids.length} cards` : cardLabel(card), items });
}

export function handMenu(card: TableCard, x: number, y: number) {
  const id = card.id;
  const data = card.cardId ? useStore.getState().cards[card.cardId] : undefined;
  const dfc = hasBackFace(data);
  const back = (useTableUi.getState().handFaces[id] ?? 0) !== 0;
  useStore.getState().openMenu({
    x,
    y,
    title: cardLabel(card),
    items: [
      { label: dfc ? `Play ${back ? "back" : "front"} face` : "Play", hint: "drag", onSelect: () => playFromHand(id) },
      ...(dfc ? [{ label: `Turn over (show ${back ? "front" : "back"})`, hint: "R", onSelect: () => turnHandCard(id) }] : []),
      { label: "Play face down", onSelect: () => moveTo([id], "battlefield", { faceDown: true }) },
      { separator: true, label: "" },
      { label: "Discard", onSelect: () => moveTo([id], "graveyard") },
      { label: "Exile", onSelect: () => moveTo([id], "exile") },
      { label: "Put on top of library", onSelect: () => moveTo([id], "library") },
      { label: "Put on bottom of library", onSelect: () => moveTo([id], "library", { bottom: true }) },
      { separator: true, label: "" },
      { label: "Reveal to everyone", onSelect: () => act({ a: "reveal", ids: [id] }) },
    ],
  });
}

export function pileMenu(ownerId: string, zone: Exclude<ZoneName, "battlefield" | "hand">, x: number, y: number) {
  const mine = ownerId === me();
  const t = table();
  const player = t?.players[ownerId];
  const count = player?.zones[zone].length ?? 0;
  const names = useStore.getState().view?.players ?? [];
  const ownerName = names.find((p) => p.id === ownerId)?.name ?? "Player";
  const view = () => useTableUi.getState().setViewer({ playerId: ownerId, zone });
  let items: MenuItem[] = [];
  if (zone === "library") {
    items = mine
      ? [
          { label: "Draw a card", hint: "D", onSelect: () => act({ a: "draw", n: 1 }) },
          { label: "Draw X…", onSelect: () => askNumber("Draw how many?", 2, (n) => act({ a: "draw", n })) },
          { label: "Shuffle", onSelect: () => act({ a: "shuffle" }) },
          { separator: true, label: "" },
          {
            label: "Look at top X… (scry / surveil)",
            onSelect: () =>
              askNumber("Look at how many?", 3, (n) => {
                act({ a: "peek", n });
                view();
              }),
          },
          {
            label: "Search library",
            onSelect: () => {
              act({ a: "peek", n: count });
              view();
            },
          },
          { label: "Mill X…", onSelect: () => askNumber("Mill how many?", 1, (n) => act({ a: "mill", n })) },
          { label: "Reveal top card", onSelect: () => player?.zones.library[0] && act({ a: "reveal", ids: [player.zones.library[0]] }) },
          { separator: true, label: "" },
          // Always confirmed (see guards).
          { label: "Mulligan (shuffle hand in, redraw)", onSelect: () => act({ a: "mulligan" }) },
        ]
      : [{ label: `${ownerName}'s library: ${count} cards`, disabled: true }];
  } else if (zone === "sideboard" && !mine) {
    items = [{ label: `${ownerName}'s sideboard: ${count} cards`, disabled: true }];
  } else {
    items = [{ label: `View ${zone} (${count})`, onSelect: view, disabled: count === 0 }];
    if (mine && zone === "graveyard" && count > 0) {
      items.push({ label: "Exile entire graveyard", onSelect: () => player && moveTo(player.zones.graveyard.slice(), "exile") });
      items.push({ label: "Shuffle graveyard into library", onSelect: () => player && actAll([{ a: "move", ids: player.zones.graveyard.slice(), to: "library" }, { a: "shuffle" }]) });
    }
  }
  // Point everyone at the pile (its spot on the owner's mat).
  const seat = player?.seat;
  if (t && seat !== undefined) {
    const at = pilePosition(zone, seat, t.seats.length);
    items.push({ separator: true, label: "" }, { label: `Ping this ${zone === "library" ? "library" : "pile"}`, icon: "pin", hint: "Tab", onSelect: () => pingAt(at.x, at.y) });
  }
  useStore.getState().openMenu({ x, y, title: `${mine ? "Your" : `${ownerName}'s`} ${zone}`, items });
}

export function askNumber(question: string, initial: number, then: (n: number) => void) {
  useTableUi.getState().set({
    ask: {
      question,
      kind: "number",
      initial: String(initial),
      onSubmit: (raw) => {
        const n = Math.floor(Number(raw));
        if (Number.isFinite(n) && n > 0) then(Math.min(60, n));
      },
    },
  });
}
