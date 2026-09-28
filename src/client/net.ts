// WebSocket connection to the room Durable Object with automatic reconnect.

import { CLOSE, type ClientMessage, type ServerMessage } from "../shared/protocol";
import { loadIdentity, loadName, saveIdentity } from "./identity";
import { useStore } from "./store";
import { showPing } from "./table/tableUi";
import { rememberExpiry } from "./publicRooms";

let socket: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let currentCode: string | null = null;
let claim: string | null = null;
let queue: string[] = [];
let heartbeat: ReturnType<typeof setInterval> | undefined;

/** Heartbeat period. The server answers "ping" with "pong" without waking the room. */
const HEARTBEAT_MS = 10_000;
/** A ping unanswered this long means the connection is dead even if no close event came. */
const PONG_TIMEOUT_MS = 10_000;

const CLOSE_MESSAGES: Record<number, string> = {
  [CLOSE.notFound]: "This room doesn't exist. Check the code?",
  [CLOSE.deleted]: "This room was deleted.",
  [CLOSE.expired]: "This public room has closed.",
  [CLOSE.offline]: "Online rooms are turned off right now.",
};

export async function roomExists(code: string): Promise<boolean> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/info`);
  return res.ok;
}

/** Connects to a room. `claimSeat` takes over that free seat (after the server offered it). */
export function connect(code: string, claimSeat?: string) {
  if (!claimSeat && currentCode === code && socket && socket.readyState <= WebSocket.OPEN) return;
  disconnect();
  currentCode = code;
  claim = claimSeat ?? null;
  retry = 0;
  useStore.setState({ mode: "online", sendImpl: sendRaw, claimSeats: [] });
  open();
}

export function disconnect() {
  currentCode = null;
  claim = null;
  queue = [];
  clearTimeout(retryTimer);
  clearInterval(heartbeat);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  useStore.setState({ status: "idle", view: null, fatal: null, fatalCode: null, cards: {}, claimSeats: [] });
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
  if (claim) params.set("claim", claim);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws?${params}`);
  socket = ws;
  // A server error before "welcome" means the join was refused (room full, started, missing).
  let welcomed = false;
  let refusal: string | null = null;
  useStore.setState({ status: retry === 0 ? "connecting" : "reconnecting" });

  const stop = (update: Partial<ReturnType<typeof useStore.getState>>) => {
    clearInterval(heartbeat);
    ws.onclose = null;
    ws.close();
    socket = null;
    useStore.setState(update);
  };

  // Reconnect as if the socket had closed (used when it has silently died).
  const lost = () => {
    ws.onclose = null;
    ws.close();
    clearInterval(heartbeat);
    if (socket === ws) socket = null;
    if (!currentCode) return;
    const delay = Math.min(8000, 400 * 2 ** retry++);
    useStore.setState({ status: "reconnecting" });
    retryTimer = setTimeout(open, delay);
  };

  // Judged against our own last ping, not wall-clock silence: background tabs may only get to run
  // this once a minute, and that alone mustn't look like a dead connection.
  let pingSentAt: number | null = null;
  ws.onopen = () => {
    retry = 0;
    useStore.setState({ status: "open" });
    for (const m of queue) ws.send(m);
    queue = [];
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (pingSentAt !== null && performance.now() - pingSentAt > PONG_TIMEOUT_MS) return lost();
      pingSentAt = performance.now();
      ws.send("ping");
    }, HEARTBEAT_MS);
  };

  ws.onmessage = (event) => {
    pingSentAt = null;
    const text = String(event.data);
    if (text === "pong") return;
    const msg = JSON.parse(text) as ServerMessage;
    const store = useStore.getState();
    store.setDebug({ msgIn: store.debug.msgIn + 1, bytesIn: store.debug.bytesIn + text.length });
    switch (msg.t) {
      case "welcome":
        welcomed = true;
        claim = null;
        saveIdentity(msg.code, { pid: msg.you, secret: msg.secret });
        break;
      case "state":
        if (msg.view.expiresAt && !useStore.getState().view?.expiresAt) rememberExpiry(msg.view.code, msg.view.expiresAt);
        useStore.setState({ view: msg.view, clockOffset: msg.view.serverNow - Date.now() });
        break;
      case "cards":
        useStore.setState({ cards: msg.cards });
        break;
      case "drag":
        useStore.setState((s) => ({ drags: { ...s.drags, [msg.id]: { by: msg.by, x: msg.x, y: msg.y, at: performance.now() } } }));
        break;
      case "claim":
        // The game started without us (or we're on a new device): show the seat picker.
        stop({ status: "claim", claimSeats: msg.seats });
        break;
      case "closed":
        // Final: don't wait for the close event (it can trail the message by seconds).
        stop({ status: "failed", fatal: msg.message || CLOSE_MESSAGES[msg.code] || "This room is no longer available.", fatalCode: msg.code });
        break;
      case "point":
        showPing(msg.by, msg.x, msg.y);
        break;
      case "error":
        if (!welcomed) {
          // Refused join: stop here rather than waiting for (or retrying after) the close.
          refusal = msg.message;
          stop({ status: "failed", fatal: refusal });
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
    clearInterval(heartbeat);
    // 4xxx closes are the server saying "don't come back" (refused, missing, deleted, offline).
    if (refusal || (event.code >= 4000 && event.code < 5000)) {
      useStore.setState({ status: "failed", fatal: refusal ?? CLOSE_MESSAGES[event.code] ?? "Could not join this room.", fatalCode: event.code >= 4000 ? event.code : null });
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
