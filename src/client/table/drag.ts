// Pointer-driven dragging shared by battlefield cards (3D) and hand cards (DOM).
// A press becomes a drag after a few pixels; releasing drops onto a pile, the hand, or the battlefield.

import { pileAt, type Vec2 } from "../../shared/tableLayout";
import { useStore } from "../store";
import { act, moveTo, playFromHand, settle, table, useTableUi, type LocalDrag } from "./tableUi";

/** Set by the canvas: converts a screen point to table coordinates (ray vs. table plane). */
export const tableApi: { screenToTable: (clientX: number, clientY: number) => Vec2 | null } = {
  screenToTable: () => null,
};

export function isOverHand(clientY: number): boolean {
  const el = document.querySelector(".hand-zone");
  if (!el) return false;
  return clientY >= el.getBoundingClientRect().top;
}

let lastSent = 0;

export function beginDrag(
  e: { clientX: number; clientY: number; button?: number },
  source: LocalDrag["source"],
  ids: string[],
  onClick: () => void,
) {
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  const t = table();
  const start = tableApi.screenToTable(startX, startY) ?? { x: 0, y: 0 };
  const offsets: LocalDrag["offsets"] = {};
  for (const id of ids) {
    const c = t?.cards[id];
    offsets[id] = source === "battlefield" && c ? { dx: c.x - start.x, dy: c.y - start.y } : { dx: 0, dy: 0 };
  }

  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
    dragging = true;
    document.body.classList.add("dragging");
    const pt = tableApi.screenToTable(ev.clientX, ev.clientY) ?? start;
    useTableUi.getState().setDrag({ ids, source, x: pt.x, y: pt.y, clientX: ev.clientX, clientY: ev.clientY, offsets, overHand: isOverHand(ev.clientY) });
    const now = performance.now();
    if (source === "battlefield" && now - lastSent > 50) {
      lastSent = now;
      const o = offsets[ids[0]];
      useStore.getState().send({ t: "drag", id: ids[0], x: pt.x + o.dx, y: pt.y + o.dy });
    }
  };

  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("dragging");
    if (!dragging) {
      onClick();
      return;
    }
    const pt = tableApi.screenToTable(ev.clientX, ev.clientY);
    useTableUi.getState().setDrag(null);
    drop(source, ids, offsets, pt, isOverHand(ev.clientY));
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function drop(source: LocalDrag["source"], ids: string[], offsets: LocalDrag["offsets"], pt: Vec2 | null, overHand: boolean) {
  const t = table();
  if (!t) return;
  if (overHand) {
    if (source === "battlefield") moveTo(ids, "hand");
    return;
  }
  if (!pt) return;
  const pile = pileAt(pt, t.seats.length);
  if (pile) {
    moveTo(ids, pile.zone);
    return;
  }
  if (source === "hand") {
    for (const id of ids) playFromHand(id, { x: pt.x, y: pt.y });
    return;
  }
  const targets: Record<string, Vec2> = {};
  for (const id of ids) {
    const o = offsets[id];
    targets[id] = { x: pt.x + o.dx, y: pt.y + o.dy };
    act({ a: "setPos", id, ...targets[id] });
  }
  settle(targets);
}
