// Cloudflare Worker entry: a small HTTP API, invite checks, and routing websockets to one Durable
// Object per room. Static client assets are served by Workers Static Assets (see wrangler.jsonc).
//
//   POST   /api/rooms                 create a room          (invite key required)
//   GET    /api/invite                invite info + "My rooms" (invite key required)
//   DELETE /api/invite/rooms/:code    delete one of the invite's rooms (invite key required)
//   GET    /api/rooms/:code/info      does the room exist?   (anyone with the code)
//   GET    /api/rooms/:code/ws        join via websocket     (anyone with the code)
//
// Room codes are signed (see shared/roomCode.ts), so forged or mistyped codes are answered here
// without waking a Durable Object.

import { inviteLabelFor, parseInviteCodes } from "../shared/invites";
import { CLOSE } from "../shared/protocol";
import { verifyRoomCode } from "../shared/roomCode";
import { inviteStub, onlineEnabled, roomStub, type Env } from "./env";
export { RoomDurableObject } from "./roomObject";
export { InviteDurableObject } from "./inviteObject";

const OFFLINE_MESSAGE = "Online rooms are turned off right now. Solo mode still works!";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function isWebSocket(request: Request) {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

/** Refuses a websocket from the Worker itself: the client gets a readable error and a final close code. */
function refuseSocket(code: number, message: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.send(JSON.stringify({ t: "error", message }));
  server.close(code, message.slice(0, 100));
  return new Response(null, { status: 101, webSocket: client });
}

/** The invite label for the request's `Authorization: Bearer <key>`, or null. */
function inviteLabel(request: Request, env: Env): string | null {
  const auth = request.headers.get("Authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  return inviteLabelFor(parseInviteCodes(env.INVITE_CODES), key);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api", "rooms", CODE, "ws"]

    if (url.pathname === "/api/health") return json({ ok: true, online: onlineEnabled(env) });

    // --- invite-only endpoints -------------------------------------------------------------------

    if (parts[0] === "api" && (parts[1] === "invite" || (parts[1] === "rooms" && parts.length === 2))) {
      if (!onlineEnabled(env)) return json({ error: OFFLINE_MESSAGE }, 503);
      const label = inviteLabel(request, env);
      if (!label) return json({ error: "That invite code isn't valid." }, 401);
      const invite = inviteStub(env, label);

      if (parts[1] === "rooms" && request.method === "POST") {
        const res = await invite.createRoom(label);
        return res.ok ? json({ code: res.code }) : json({ error: res.error }, res.status);
      }
      if (parts[1] === "invite" && parts.length === 2 && request.method === "GET") {
        return json(await invite.info(label));
      }
      if (parts[1] === "invite" && parts[2] === "rooms" && parts[3] && parts.length === 4 && request.method === "DELETE") {
        const deleted = await invite.deleteRoom(label, parts[3].toUpperCase());
        return deleted ? json({ ok: true }) : json({ error: "That room isn't one of this invite's rooms." }, 404);
      }
      return json({ error: "Not found" }, 404);
    }

    // --- anyone with a room code -----------------------------------------------------------------

    if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
      const code = parts[2].toUpperCase();
      const action = parts.slice(3).join("/") || "info";
      if (action !== "info" && action !== "ws") return json({ error: "Not found" }, 404);
      const ws = action === "ws" && isWebSocket(request);

      if (!onlineEnabled(env)) return ws ? refuseSocket(CLOSE.offline, OFFLINE_MESSAGE) : json({ error: OFFLINE_MESSAGE }, 503);
      if (!env.ROOM_CODE_SECRET) return json({ error: "The server is missing ROOM_CODE_SECRET." }, 503);
      if (!(await verifyRoomCode(env.ROOM_CODE_SECRET, code))) {
        const message = `There's no room ${code}. Check the code?`;
        return ws ? refuseSocket(CLOSE.notFound, message) : json({ error: message }, 404);
      }
      return roomStub(env, code).fetch(new Request(`https://room/${code}/${action}${url.search}`, request));
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
