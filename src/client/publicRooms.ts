// Public rooms from the browser's side: the pool status and create calls, the optional Turnstile
// widget, the public room this browser hosts (the server's status is the same for everyone, so
// "your room" is remembered here), and a note of each public room's closing time (so an old link
// can say "this room has closed" rather than "no such room").

import { useEffect, useRef, useState } from "react";
import { TURNSTILE_ACTION, type PublicStatus } from "../shared/publicRooms";
import { rememberRoom } from "./recentRooms";

const EXPIRY_KEY = "hyperdraft:public:";
const MINE_KEY = "hyperdraft:public-mine";
const STATUS_KEY = "hyperdraft:public-status";

export async function fetchPublicStatus(): Promise<PublicStatus> {
  const res = await fetch("/api/public");
  if (!res.ok) return { enabled: false };
  const status = (await res.json()) as PublicStatus;
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(status));
  } catch {
    /* storage unavailable */
  }
  return status;
}

/**
 * The last status this browser fetched, so Home can lay out the hosting section before the fresh one arrives. Null
 * if there's none, or it doesn't have the shape this build expects (it may be from an older one).
 */
export function loadPublicStatus(now = Date.now()): PublicStatus | null {
  try {
    const o = JSON.parse(localStorage.getItem(STATUS_KEY) ?? "null") as Record<string, unknown> | null;
    if (typeof o?.enabled !== "boolean") return null;
    if (!o.enabled) return { enabled: false };
    const num = (v: unknown) => (typeof v === "number" ? v : undefined);
    // A pool that was full or booked then may well be open by now.
    const future = (v: unknown) => (typeof v === "number" && v > now ? v : null);
    return {
      enabled: true,
      slots: num(o.slots),
      used: num(o.used),
      nextFreeAt: future(o.nextFreeAt),
      nextRoomMs: num(o.nextRoomMs),
      reopensAt: future(o.reopensAt),
      idleMs: num(o.idleMs),
      turnstileSiteKey: typeof o.turnstileSiteKey === "string" ? o.turnstileSiteKey : null,
    };
  } catch {
    return null;
  }
}

export class PublicRoomError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Set when the visitor already has a public room open: that room. */
    public code?: string,
    public expiresAt?: number,
  ) {
    super(message);
  }
}

export async function createPublicRoom(turnstileToken: string | null): Promise<{ code: string; expiresAt: number }> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(turnstileToken ? { turnstileToken } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; expiresAt?: number; error?: string };
  if (!res.ok || !body.code || !body.expiresAt) throw new PublicRoomError(body.error ?? `Request failed (${res.status}).`, res.status, body.code, body.expiresAt);
  return { code: body.code, expiresAt: body.expiresAt };
}

/** The public room this browser hosts, while it can still be open. */
export function loadMine(): { code: string; expiresAt: number } | null {
  try {
    const mine = JSON.parse(localStorage.getItem(MINE_KEY) ?? "null") as { code: string; expiresAt: number } | null;
    return mine && mine.expiresAt > Date.now() ? mine : null;
  } catch {
    return null;
  }
}

export function rememberMine(code: string, expiresAt: number) {
  rememberExpiry(code, expiresAt);
  rememberRoom(code, { hosted: true, expiresAt });
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify({ code, expiresAt }));
  } catch {
    /* storage unavailable */
  }
}

/** Forgets the hosted room once it's known to be closed. */
export function forgetMine(code: string) {
  try {
    if (loadMine()?.code === code) localStorage.removeItem(MINE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Remembers when a public room closes (seen in its view), for a friendlier message afterwards. */
export function rememberExpiry(code: string, expiresAt: number) {
  try {
    localStorage.setItem(EXPIRY_KEY + code, String(expiresAt));
  } catch {
    /* storage unavailable */
  }
}

/** When this public room closes (or closed), if this browser has been in it. */
export function knownExpiry(code: string): number | null {
  try {
    const raw = localStorage.getItem(EXPIRY_KEY + code);
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
}

// --- Turnstile ----------------------------------------------------------------------------------

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoad: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load.")));
    s.onerror = () => {
      scriptLoad = null;
      reject(new Error("Turnstile didn't load."));
    };
    document.head.appendChild(s);
  });
  return scriptLoad;
}

/**
 * Renders a Turnstile widget into the returned ref when `siteKey` is set. Most visitors never see
 * it ("interaction-only"); `token` is the pass to send with the next create. Tokens are single-use
 * and last five minutes, so call `reset` after using one.
 */
export function useTurnstile(siteKey: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    const el = ref.current;
    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        widget.current = api.render(el, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          appearance: "interaction-only",
          theme: "dark",
          callback: (t: string) => {
            setToken(t);
            setFailed(false);
          },
          "expired-callback": () => setToken(null),
          "error-callback": () => {
            setToken(null);
            setFailed(true);
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
      setToken(null);
    };
  }, [siteKey]);

  const reset = () => {
    setToken(null);
    if (widget.current) window.turnstile?.reset(widget.current);
  };

  return { ref, token, failed, reset };
}
