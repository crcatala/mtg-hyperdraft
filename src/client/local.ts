// Offline solo mode: the same `Room` engine the Durable Object runs, hosted in this tab instead.
// The screens can't tell the difference: messages go through `store.send`, views come back through
// the store. Nothing is persisted; closing the tab ends the game.

import { createRoomState, Room } from "../shared/room";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import { importCube } from "../shared/importCube";
import { loadName } from "./identity";
import { useStore } from "./store";

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
  const { playerId } = room.join({ name: loadName() || "You" });
  for (let i = 0; i < SOLO_BOTS; i++) room.handle(playerId, { t: "addBot" });
  session = { room, playerId };
  useStore.setState({
    mode: "solo",
    status: "open",
    fatal: null,
    claimSeats: [],
    cards: {},
    clockOffset: 0,
    view: room.viewFor(playerId),
    sendImpl: (msg) => queueMicrotask(() => deliver(msg)),
  });
}

export function stopLocal() {
  if (session) clearTimeout(session.timer);
  session = null;
  useStore.setState({ status: "idle", view: null, cards: {}, mode: "online", sendImpl: () => {} });
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
}

function publish() {
  const s = session;
  if (!s) return;
  useStore.setState({ view: s.room.viewFor(s.playerId) });
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
