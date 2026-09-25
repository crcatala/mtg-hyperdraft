// Table-only UI state + action helpers shared by the 3D scene and the DOM overlay.

import { create } from "zustand";
import type { TableAction } from "../../shared/table";
import type { TableCard, TableState, ZoneName } from "../../shared/types";
import { useStore, type MenuItem } from "../store";
import { hasBackFace } from "../cardStyle";
import { sfx } from "../sfx";

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

export interface AskState {
  question: string;
  kind: "number" | "text" | "confirm";
  initial?: string;
  onSubmit: (value: string) => void;
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
  overview: boolean;
  logOpen: boolean;
  ask: AskState | null;
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
  logOpen: true,
  ask: null,
  setSelected: (selected) => set({ selected }),
  setHovered: (hovered) => set({ hovered }),
  setDrag: (drag) => set({ drag }),
  setViewer: (viewer) => set({ viewer }),
  set: (p) => set(p),
}));

export function act(action: TableAction) {
  useStore.getState().send({ t: "table", action });
}

export function table(): TableState | null {
  return useStore.getState().view?.table ?? null;
}

export function me(): string {
  return useStore.getState().view?.you ?? "";
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

export function toggleTap(ids: string[]) {
  const t = table();
  const cards = ids.map((id) => t?.cards[id]).filter((c): c is TableCard => !!c && c.zone === "battlefield");
  if (cards.length === 0) return;
  sfx.tap();
  act({ a: "tap", ids: cards.map((c) => c.id), tapped: !cards[0].tapped });
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
    ...(!many ? [{ label: "Create token copy", onSelect: () => act({ a: "clone", id: card.id }) }] : []),
  ];
  useStore.getState().openMenu({ x, y, title: many ? `${ids.length} cards` : cardLabel(card), items });
}

export function handMenu(card: TableCard, x: number, y: number) {
  const id = card.id;
  useStore.getState().openMenu({
    x,
    y,
    title: cardLabel(card),
    items: [
      { label: "Play", hint: "dbl-click / drag", onSelect: () => moveTo([id], "battlefield") },
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
          {
            label: "Mulligan (shuffle hand in, redraw)",
            onSelect: () => useTableUi.getState().set({ ask: { question: "Shuffle your hand into your library and draw a new hand?", kind: "confirm", onSubmit: () => act({ a: "mulligan" }) } }),
          },
        ]
      : [{ label: `${ownerName}'s library: ${count} cards`, disabled: true }];
  } else if (zone === "sideboard" && !mine) {
    items = [{ label: `${ownerName}'s sideboard: ${count} cards`, disabled: true }];
  } else {
    items = [{ label: `View ${zone} (${count})`, onSelect: view, disabled: count === 0 }];
    if (mine && zone === "graveyard" && count > 0) {
      items.push({ label: "Exile entire graveyard", onSelect: () => player && moveTo(player.zones.graveyard.slice(), "exile") });
      items.push({ label: "Shuffle graveyard into library", onSelect: () => player && (moveTo(player.zones.graveyard.slice(), "library"), setTimeout(() => act({ a: "shuffle" }), 50)) });
    }
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
