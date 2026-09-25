// Per-room player identity kept in localStorage so a refresh or closed tab can rejoin the same seat.
// `?as=2` in the URL namespaces the identity so several tabs on one machine can be different players.

export interface Identity {
  pid: string;
  secret: string;
}

const NAME_KEY = "hyperdraft:name";

function alias(): string {
  return new URLSearchParams(location.search).get("as") ?? "";
}

function key(code: string) {
  const a = alias();
  return `hyperdraft:id:${code}${a ? `:${a}` : ""}`;
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable (private mode) — identity lasts for this page only */
  }
}

export function loadIdentity(code: string): Identity | null {
  const raw = safeGet(key(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

export function saveIdentity(code: string, id: Identity) {
  safeSet(key(code), JSON.stringify(id));
}

export function loadName(): string {
  const a = alias();
  return safeGet(a ? `${NAME_KEY}:${a}` : NAME_KEY) ?? "";
}

export function saveName(name: string) {
  const a = alias();
  safeSet(a ? `${NAME_KEY}:${a}` : NAME_KEY, name);
}

export function withAlias(path: string): string {
  const a = alias();
  return a ? `${path}?as=${encodeURIComponent(a)}` : path;
}
