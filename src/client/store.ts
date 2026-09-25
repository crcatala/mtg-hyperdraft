// Global client state: connection, latest room view, card data, and UI bits shared across screens.

import { create } from "zustand";
import type { ClientMessage, RoomView } from "../shared/protocol";
import type { CardMap } from "../shared/types";

export type ConnStatus = "idle" | "connecting" | "open" | "reconnecting" | "failed";

export interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export interface RemoteDrag {
  by: string;
  x: number;
  y: number;
  at: number;
}

export interface PreviewState {
  cardId?: string;
  face?: number;
  foil?: boolean;
}

export interface MenuItem {
  label: string;
  hint?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  title?: string;
  items: MenuItem[];
}

interface DebugState {
  open: boolean;
  forceText: boolean;
  msgIn: number;
  msgOut: number;
  bytesIn: number;
}

interface Store {
  status: ConnStatus;
  fatal: string | null;
  view: RoomView | null;
  cards: CardMap;
  clockOffset: number;
  drags: Record<string, RemoteDrag>;
  toasts: Toast[];
  preview: PreviewState;
  menu: MenuState | null;
  debug: DebugState;
  sendImpl: (msg: ClientMessage) => void;

  send: (msg: ClientMessage) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  setPreview: (p: PreviewState) => void;
  openMenu: (m: MenuState) => void;
  closeMenu: () => void;
  setDebug: (d: Partial<DebugState>) => void;
}

let toastId = 1;

export const useStore = create<Store>((set, get) => ({
  status: "idle",
  fatal: null,
  view: null,
  cards: {},
  clockOffset: 0,
  drags: {},
  toasts: [],
  preview: {},
  menu: null,
  debug: { open: false, forceText: false, msgIn: 0, msgOut: 0, bytesIn: 0 },
  sendImpl: () => {},

  send: (msg) => {
    set((s) => ({ debug: { ...s.debug, msgOut: s.debug.msgOut + 1 } }));
    get().sendImpl(msg);
  },
  toast: (text, kind = "info") => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 5000 : 3000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPreview: (preview) => set({ preview }),
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
  setDebug: (d) => set((s) => ({ debug: { ...s.debug, ...d } })),
}));

/** Server clock "now", corrected for the local clock offset (for pick timers). */
export function serverNow(): number {
  return Date.now() + useStore.getState().clockOffset;
}

export function useMe(): string | null {
  return useStore((s) => s.view?.you ?? null);
}
