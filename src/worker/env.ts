import type { InviteDurableObject } from "./inviteObject";
import type { PublicPoolDurableObject } from "./publicPoolObject";
import type { RoomDurableObject } from "./roomObject";

export interface Env {
  /** The built client (Workers Static Assets), including bundled preset cubes. */
  ASSETS: Fetcher;
  /** One Durable Object per room, addressed by room code. */
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
  /** One Durable Object per invite label: quotas, "My rooms" and lazy expiry. */
  INVITES: DurableObjectNamespace<InviteDurableObject>;
  /** Secret: signs room codes so made-up codes are rejected before reaching a Durable Object. */
  ROOM_CODE_SECRET?: string;
  /** Secret: `label:key` pairs, comma- or newline-separated. See README → Invites. */
  INVITE_CODES?: string;
  /** The single public room pool: slots, per-visitor limit. */
  PUBLIC_POOL: DurableObjectNamespace<PublicPoolDurableObject>;
  /** Kill switch: set to "false" to turn off online rooms (solo mode keeps working). */
  ONLINE_ENABLED?: string;
  /** Opt-in: set to "true" to let anyone host public rooms without an invite. Off when unset. */
  PUBLIC_ROOMS_ENABLED?: string;
  /** Cloudflare Turnstile keys. Public hosting asks for a Turnstile check only when both are set. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export function onlineEnabled(env: Env): boolean {
  return env.ONLINE_ENABLED?.trim().toLowerCase() !== "false";
}

/** Public rooms are opt-in (unlike online rooms as a whole), and off whenever online rooms are. */
export function publicRoomsEnabled(env: Env): boolean {
  return onlineEnabled(env) && env.PUBLIC_ROOMS_ENABLED?.trim().toLowerCase() === "true";
}

/** The Turnstile keys, or null when either is missing (then no Turnstile check is asked for). */
export function turnstileKeys(env: Env): { siteKey: string; secretKey: string } | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim();
  return siteKey && secretKey ? { siteKey, secretKey } : null;
}

export function publicPoolStub(env: Env) {
  return env.PUBLIC_POOL.get(env.PUBLIC_POOL.idFromName("public-pool"));
}

export function inviteStub(env: Env, label: string) {
  return env.INVITES.get(env.INVITES.idFromName(`invite:${label}`));
}

export function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}
