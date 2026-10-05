// Lists the companion voice files that are actually shipped, for the game to load (src/client/companionVoices.json):
// companion id -> slot -> how many takes it has. A slot with one take is <slot>.mp3, with several <slot>-1.mp3 ... <slot>-N.mp3
// (the same naming rule as the sound packs). The client reads the list instead of probing for files, so a companion
// that has no audio yet costs no requests and no 404s. Run it after adding or replacing files in public/sfx/companions/;
// tests/companionVoice.test.ts fails when the list is stale.
//
//   node scripts/sync-companion-voices.mjs

import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "sfx", "companions");

const manifest = {};
for (const id of readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const slots = {};
  for (const file of readdirSync(join(DIR, id)).filter((f) => f.endsWith(".mp3")).sort()) {
    const slot = file.replace(/\.mp3$/, "").replace(/-\d+$/, "");
    slots[slot] = (slots[slot] ?? 0) + 1;
  }
  manifest[id] = slots;
}
writeFileSync(join(ROOT, "src", "client", "companionVoices.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(Object.entries(manifest).map(([id, s]) => `${id}: ${Object.values(s).reduce((a, b) => a + b, 0)} file(s) in ${Object.keys(s).length} slot(s)`).join("\n") || "no companion voices yet");
