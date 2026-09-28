// Public rooms from the browser's side: the pool status and create calls, the optional Turnstile
// widget, and a note of each public room's closing time (so an old link can say "this room has
// closed" rather than "no such room").

import { useEffect, useRef, useState } from "react";
import type { PublicStatus } from "../shared/publicRooms";

const EXPIRY_KEY = "hyperdraft:public:";

export async function fetchPublicStatus(): Promise<PublicStatus> {
  const res = await fetch("/api/public");
  if (!res.ok) return { enabled: false };
  return (await res.json()) as PublicStatus;
}

export class PublicRoomError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Set when the visitor already has a public room open. */
    public code?: string,
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
  if (!res.ok || !body.code || !body.expiresAt) throw new PublicRoomError(body.error ?? `Request failed (${res.status}).`, res.status, body.code);
  return { code: body.code, expiresAt: body.expiresAt };
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
          action: "host-public-room",
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
