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

/** A localStorage key kept apart per `?as=` alias, so test tabs don't share identities or lists. */
export function aliasedKey(k: string): string {
  const a = alias();
  return a ? `${k}:${a}` : k;
}

function key(code: string) {
  return aliasedKey(`hyperdraft:id:${code}`);
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
  return safeGet(aliasedKey(NAME_KEY)) ?? "";
}

export function saveName(name: string) {
  safeSet(aliasedKey(NAME_KEY), name);
}

const LOOK_KEY = "hyperdraft:look";

/** The avatar and companion the player chose for themselves (nothing saved until they pick one). */
export interface LookPref {
  avatar?: string;
  companion?: string;
}

export function loadLook(): LookPref {
  const raw = safeGet(aliasedKey(LOOK_KEY));
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as LookPref;
    return { avatar: typeof v.avatar === "string" ? v.avatar : undefined, companion: typeof v.companion === "string" ? v.companion : undefined };
  } catch {
    return {};
  }
}

/**
 * `prev` with one choice changed (`null` clears it). Callers pass what's saved in the browser rather than
 * the room's current state, which may not have caught up with the player's last pick yet.
 */
export function mergeLook(prev: LookPref, field: keyof LookPref, id: string | null): LookPref {
  const next = { ...prev };
  if (id) next[field] = id;
  else delete next[field];
  return next;
}

export function saveLook(look: LookPref) {
  safeSet(aliasedKey(LOOK_KEY), JSON.stringify(look));
}

export function withAlias(path: string): string {
  const a = alias();
  return a ? `${path}?as=${encodeURIComponent(a)}` : path;
}
