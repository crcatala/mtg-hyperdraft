// Cloudflare Worker entry: tiny HTTP API + routing websockets to one Durable Object per room.
// Static client assets are served by Workers Static Assets (see wrangler.jsonc).

import { randomCode } from "../shared/rng";
export { RoomDurableObject } from "./roomObject";

export interface Env {
  ROOMS: DurableObjectNamespace;
}

const CODE = /^[A-Z0-9]{4,8}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "rooms", CODE, "ws"]

    if (url.pathname === "/api/health") return json({ ok: true });

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      // Codes are random; a collision would just join an existing room, so check and retry.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode(Math.random);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch(`https://room/${code}/init`, { method: "POST" });
        if (res.ok) return json({ code });
      }
      return json({ error: "Could not allocate a room code, try again." }, 503);
    }

    if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
      const code = parts[2].toUpperCase();
      if (!CODE.test(code)) return json({ error: "Bad room code." }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const rest = parts.slice(3).join("/") || "info";
      return stub.fetch(new Request(`https://room/${code}/${rest}${url.search}`, request));
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
