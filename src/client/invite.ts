// The invite key that lets this browser host online rooms. It arrives either typed into Home or via
// a magic link (`/?invite=KEY`), is kept in localStorage, and is only ever sent to the invite-only
// endpoints (create a room, "My rooms"), never on websocket joins.

import type { InviteInfo } from "../shared/invites";

const KEY = "hyperdraft:invite";
const INFO_KEY = "hyperdraft:invite-info";

export function loadInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveInvite(key: string) {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function forgetInvite() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(INFO_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Saves `?invite=` from the address bar and strips it, so the key doesn't linger in history or screenshots. */
export function captureInviteFromUrl() {
  const url = new URL(location.href);
  const key = url.searchParams.get("invite")?.trim();
  if (!url.searchParams.has("invite")) return;
  if (key) saveInvite(key);
  url.searchParams.delete("invite");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

export class InviteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, key: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${key}` } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new InviteError(body.error ?? `Request failed (${res.status}).`, res.status);
  return body;
}

export async function fetchInvite(key: string): Promise<InviteInfo> {
  const info = await call<InviteInfo>("/api/invite", key);
  try {
    localStorage.setItem(INFO_KEY, JSON.stringify({ key, info }));
  } catch {
    /* storage unavailable */
  }
  return info;
}

/** The last invite info fetched for `key`, so Home can lay out the quota and "Your rooms" before the fresh one arrives. */
export function loadInviteInfo(key: string | null): InviteInfo | null {
  if (!key) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(INFO_KEY) ?? "null") as { key: string; info: InviteInfo } | null;
    return saved?.key === key ? saved.info : null;
  } catch {
    return null;
  }
}

export async function createRoom(key: string): Promise<string> {
  return (await call<{ code: string }>("/api/rooms", key, { method: "POST" })).code;
}

export async function deleteRoom(key: string, code: string): Promise<void> {
  await call(`/api/invite/rooms/${encodeURIComponent(code)}`, key, { method: "DELETE" });
}
