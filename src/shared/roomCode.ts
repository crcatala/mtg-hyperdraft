// Signed room codes: 5 random characters + 2 check characters derived from an HMAC of the random
// part with a server secret. The Worker can reject made-up or mistyped codes without waking a
// Durable Object, so guessing codes can't spend Durable Object requests.

import { CODE_ALPHABET, randomCode, type Rng } from "./rng";

const RANDOM_LEN = 5;
const CHECK_LEN = 2;
export const ROOM_CODE_LENGTH = RANDOM_LEN + CHECK_LEN;
export const ROOM_CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keys.set(secret, key);
  }
  return key;
}

async function checkChars(secret: string, body: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  let out = "";
  for (let i = 0; i < CHECK_LEN; i++) out += CODE_ALPHABET[sig[i] % CODE_ALPHABET.length];
  return out;
}

export async function signRoomCode(secret: string, rng: Rng): Promise<string> {
  const body = randomCode(rng, RANDOM_LEN);
  return body + (await checkChars(secret, body));
}

/** True when `code` is well-formed and its check characters match the secret. */
export async function verifyRoomCode(secret: string, code: string): Promise<boolean> {
  if (!ROOM_CODE_RE.test(code)) return false;
  const body = code.slice(0, RANDOM_LEN);
  return (await checkChars(secret, body)) === code.slice(RANDOM_LEN);
}
