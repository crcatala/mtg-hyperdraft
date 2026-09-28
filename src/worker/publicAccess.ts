// Who is asking for a public room: a hashed visitor id (one public room per visitor) and the
// optional Cloudflare Turnstile check that tells browsers from scripts.

import { visitorPrefix } from "../shared/publicRooms";

const encoder = new TextEncoder();
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * A stable, anonymous id for the visitor's IP (IPv6: its /64). HMAC'd with a server secret, so the
 * pool never stores an IP address and the ids are useless anywhere else.
 */
export async function visitorId(request: Request, secret: string): Promise<string> {
  const prefix = visitorPrefix(request.headers.get("CF-Connecting-IP"));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`visitor:${prefix}`)));
  return Array.from(sig.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Checks a Turnstile token with Cloudflare. Tokens are single-use and valid for five minutes. */
export async function verifyTurnstile(token: string | undefined, secretKey: string, ip: string | null): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  const body = new FormData();
  body.append("secret", secretKey);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    const out = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!out.success) console.log("Turnstile check failed", out["error-codes"]);
    return out.success === true;
  } catch (err) {
    console.error("Turnstile siteverify failed", err);
    return false;
  }
}
