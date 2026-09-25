// Prints a fresh invite key for a label, plus what to do with it.
//   npm run invite:new -- sam
import { randomBytes } from "node:crypto";

const label = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[a-z0-9_-]{1,32}$/.test(label)) {
  console.error("Usage: npm run invite:new -- <label>   (letters, digits, - and _; e.g. sam)");
  process.exit(1);
}
// 16 characters from an unambiguous alphabet (~80 bits).
const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
const key = Array.from(randomBytes(16), (b) => alphabet[b % alphabet.length]).join("");

console.log(`
Invite entry:   ${label}:${key}

1. Add it to the INVITE_CODES secret (comma-separated with your other entries):
     npx wrangler secret put INVITE_CODES
2. Send your friend the magic link:
     https://<your-worker>.workers.dev/?invite=${key}
`);
