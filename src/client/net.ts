// WebSocket connection to the room Durable Object with automatic reconnect.

import type { ClientMessage, ServerMessage } from "../shared/protocol";
import { loadIdentity, loadName, saveIdentity } from "./identity";
import { useStore } from "./store";

let socket: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let currentCode: string | null = null;
let queue: string[] = [];

export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  const body = (await res.json()) as { code?: string; error?: string };
  if (!res.ok || !body.code) throw new Error(body.error ?? "Could not create a room.");
  return body.code;
}

export async function roomExists(code: string): Promise<boolean> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/info`);
  return res.ok;
}

export function connect(code: string) {
  if (currentCode === code && socket && socket.readyState <= WebSocket.OPEN) return;
  disconnect();
  currentCode = code;
  retry = 0;
  open();
}

export function disconnect() {
  currentCode = null;
  clearTimeout(retryTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  useStore.setState({ status: "idle", view: null, fatal: null, cards: {} });
}

function open() {
  const code = currentCode;
  if (!code) return;
  const id = loadIdentity(code);
  const params = new URLSearchParams({ name: loadName() });
  if (id) {
    params.set("pid", id.pid);
    params.set("secret", id.secret);
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws?${params}`);
  socket = ws;
  // A server error before "welcome" means the join was refused (room full, started, missing).
  let welcomed = false;
  let refusal: string | null = null;
  useStore.setState({ status: retry === 0 ? "connecting" : "reconnecting" });

  ws.onopen = () => {
    retry = 0;
    useStore.setState({ status: "open" });
    for (const m of queue) ws.send(m);
    queue = [];
  };

  ws.onmessage = (event) => {
    const text = String(event.data);
    const msg = JSON.parse(text) as ServerMessage;
    const store = useStore.getState();
    store.setDebug({ msgIn: store.debug.msgIn + 1, bytesIn: store.debug.bytesIn + text.length });
    switch (msg.t) {
      case "welcome":
        welcomed = true;
        saveIdentity(msg.code, { pid: msg.you, secret: msg.secret });
        break;
      case "state":
        useStore.setState({ view: msg.view, clockOffset: msg.view.serverNow - Date.now() });
        break;
      case "cards":
        useStore.setState({ cards: msg.cards });
        break;
      case "drag":
        useStore.setState((s) => ({ drags: { ...s.drags, [msg.id]: { by: msg.by, x: msg.x, y: msg.y, at: performance.now() } } }));
        break;
      case "error":
        if (!welcomed) {
          // Refused join: stop here rather than waiting for (or retrying after) the close.
          refusal = msg.message;
          ws.onclose = null;
          ws.close();
          socket = null;
          useStore.setState({ status: "failed", fatal: refusal });
          break;
        }
        store.toast(msg.message, "error");
        break;
      case "pong":
        break;
    }
  };

  ws.onclose = (event) => {
    socket = null;
    // Refused joins (4403/4404, or an error before welcome) are final — don't hammer the room.
    if (refusal || event.code === 4403 || event.code === 4404) {
      useStore.setState({ status: "failed", fatal: refusal ?? "Could not join this room." });
      return;
    }
    if (!currentCode) return;
    const delay = Math.min(8000, 400 * 2 ** retry++);
    useStore.setState({ status: "reconnecting" });
    retryTimer = setTimeout(open, delay);
  };
}

export function sendRaw(msg: ClientMessage) {
  const text = JSON.stringify(msg);
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(text);
  else if (msg.t !== "drag") queue.push(text);
}

useStore.setState({ sendImpl: sendRaw });
