// In-memory stand-ins for the parts of the Workers runtime a room Durable Object uses, so tests can
// drive RoomDurableObject in node. Vitest aliases `cloudflare:workers` to this file (vite.config.ts),
// and importing it installs the runtime globals (WebSocketPair, 101 responses).

export class DurableObject<Env = unknown> {
  constructor(
    protected ctx: unknown,
    protected env: Env,
  ) {}
}

/** The server end of a socket. `sent` holds what the room sent to the client. */
export class FakeSocket {
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private attachment: unknown = null;

  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
  send(text: string) {
    if (this.closed) throw new Error("socket closed");
    this.sent.push(text);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  accept() {}
}

class FakeStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;

  async get(key: string | string[]) {
    if (!Array.isArray(key)) return structuredClone(this.data.get(key));
    return new Map(key.filter((k) => this.data.has(k)).map((k) => [k, structuredClone(this.data.get(k))]));
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    if (typeof key === "string") this.data.set(key, structuredClone(value));
    else for (const [k, v] of Object.entries(key)) this.data.set(k, structuredClone(v));
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.data.delete(k);
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(at: number | Date) {
    this.alarm = Number(at);
  }
  async deleteAlarm() {
    this.alarm = null;
  }
  async deleteAll() {
    this.data.clear();
  }
}

export class FakeState {
  storage = new FakeStorage();
  sockets: FakeSocket[] = [];
  private heard = new Map<FakeSocket, number>();

  acceptWebSocket(ws: FakeSocket) {
    this.sockets.push(ws);
  }
  getWebSockets() {
    return this.sockets.filter((ws) => !ws.closed);
  }
  setWebSocketAutoResponse() {}
  getWebSocketAutoResponseTimestamp(ws: FakeSocket) {
    const at = this.heard.get(ws);
    return at === undefined ? null : new Date(at);
  }
  blockConcurrencyWhile<T>(fn: () => Promise<T>) {
    return fn();
  }
  /** A heartbeat from this socket. The runtime answers it, so the room itself never sees it. */
  ping(ws: FakeSocket) {
    this.heard.set(ws, Date.now());
  }
}

const g = globalThis as Record<string, unknown>;
g.WebSocketPair = class {
  0 = new FakeSocket();
  1 = new FakeSocket();
};
g.WebSocketRequestResponsePair = class {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
};
// Node's Response rejects status 101, which the runtime uses to hand a socket to the client.
const NodeResponse = globalThis.Response;
g.Response = class extends NodeResponse {
  constructor(body?: ConstructorParameters<typeof NodeResponse>[0], init?: ResponseInit) {
    super(body, init?.status === 101 ? { ...init, status: 200 } : init);
  }
};
