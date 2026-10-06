// Offline solo mode: the same `Room` engine the Durable Object runs, hosted in this tab instead.
// The screens can't tell the difference: messages go through `store.send`, views come back through
// the store. Nothing is persisted; closing the tab ends the game.

import { createRoomState, Room } from "../shared/room";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import { importCube } from "../shared/importCube";
import { loadLook, loadName } from "./identity";
import { useStore } from "./store";
import { forgetOpenedPacks } from "./openedPacks";
import { receiveTreat, receiveVend } from "./table/treatShow";

const SOLO_BOTS = 3;

interface LocalSession {
  room: Room;
  playerId: string;
  timer?: ReturnType<typeof setTimeout>;
}

let session: LocalSession | null = null;

export function startLocal() {
  stopLocal();
  const room = new Room(createRoomState("SOLO", Date.now()), {}, { now: () => Date.now(), rng: Math.random });
  // Every solo game reuses the code "SOLO" and the same pack ids: let its packs be opened afresh.
  forgetOpenedPacks("SOLO");
  const { playerId } = room.join({ name: loadName() || "You", ...loadLook() });
  for (let i = 0; i < SOLO_BOTS; i++) room.handle(playerId, { t: "addBot" });
  session = { room, playerId };
  useStore.setState({
    mode: "solo",
    status: "open",
    fatal: null,
    fatalCode: null,
    claimSeats: [],
    cards: {},
    clockOffset: 0,
    view: viewOf(room, playerId),
    sendImpl: (msg) => queueMicrotask(() => deliver(msg)),
  });
}

export function stopLocal() {
  if (session) clearTimeout(session.timer);
  session = null;
  useStore.setState({ status: "idle", view: null, cards: {}, mode: "online", sendImpl: () => {} });
}

/**
 * A snapshot of the room as the player sees it. `viewFor` shares arrays and objects with the live
 * room state (e.g. the game log is pushed to in place), so without a copy React selectors would
 * see "no change" and screens would miss updates. Online, every view is freshly parsed JSON;
 * cloning gives solo mode the same guarantee.
 */
function viewOf(room: Room, playerId: string) {
  return structuredClone(room.viewFor(playerId));
}

function deliver(msg: ClientMessage) {
  const s = session;
  if (!s) return;
  const result = s.room.handle(s.playerId, msg);
  for (const out of result.outbound) if (out.to === "self") receive(out.msg);
  if (result.changed) publish();
  if (result.importSource) void runImport(s, result.importSource);
}

function receive(msg: ServerMessage) {
  if (msg.t === "error") useStore.getState().toast(msg.message, "error");
  // The Treatomancer's answers come back to the buyer too (there's nobody else to tell in solo).
  else if (msg.t === "vend") receiveVend(msg.by, msg.until);
  else if (msg.t === "treat") receiveTreat(msg.show);
}

function publish() {
  const s = session;
  if (!s) return;
  useStore.setState({ view: viewOf(s.room, s.playerId) });
  schedule(s);
}

/** Pick timers: the browser's setTimeout stands in for Durable Object alarms. */
function schedule(s: LocalSession) {
  clearTimeout(s.timer);
  const at = s.room.nextAlarm();
  if (at === null) return;
  s.timer = setTimeout(() => {
    if (session !== s) return;
    if (s.room.tick()) publish();
    // Timers can fire a hair early; only retry for a deadline that's still ahead.
    else if ((s.room.nextAlarm() ?? 0) > Date.now()) schedule(s);
  }, Math.max(50, at - Date.now()));
}

async function runImport(s: LocalSession, source: string) {
  try {
    const result = await importCube(source, (url, init) => fetch(url, init), (message) => {
      if (session !== s) return;
      s.room.setImportProgress(message);
      publish();
    });
    if (session !== s) return;
    s.room.applyImport(result);
  } catch (err) {
    if (session !== s) return;
    s.room.failImport(err instanceof Error ? err.message : "Import failed.");
  }
  useStore.setState({ cards: { ...s.room.cards } });
  publish();
}
