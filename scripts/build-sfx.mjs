// Generates the sound packs in public/sfx/<pack>/ with the ElevenLabs sound-effects API.
// The generated files are committed, so this only needs to run when a prompt changes or a pack is added:
//
//   node scripts/build-sfx.mjs                      # every pack: generate whatever is missing
//   node scripts/build-sfx.mjs tabletop             # one pack (missing files only)
//   node scripts/build-sfx.mjs tabletop tear flip   # regenerate these sounds (all their takes) in that pack
//   node scripts/build-sfx.mjs tear                 # ...or in every pack, if the first word isn't a pack
//   node scripts/build-sfx.mjs --force              # regenerate everything
//
// What sounds exist (names, takes, length) is src/client/sfxManifest.json, shared with the client.
// What each sound *is* in a pack is scripts/sfx/prompts/<pack>.json. A new pack is a new prompts file
// plus an entry in src/client/soundPacks.ts. Each sound can have several takes: the client picks one
// at random so repeated sounds (flips, deals) don't machine-gun. Files are <name>.mp3, or
// <name>-1.mp3, <name>-2.mp3… when there are several. Playback gain and pitch live in src/client/sfx.ts.
//
// Needs the `elevenlabs` CLI (npm i -g @elevenlabs/cli) and ELEVENLABS_API_KEY.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "sfx");
const PROMPTS = join(ROOT, "scripts", "sfx", "prompts");
const CONCURRENCY = 5;

const manifest = JSON.parse(readFileSync(join(ROOT, "src", "client", "sfxManifest.json"), "utf8"));
const packs = readdirSync(PROMPTS).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

const force = process.argv.includes("--force");
const words = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const only = packs.includes(words[0]) ? [words.shift()] : packs;
const names = words;

/** Every (pack, sound, take) that should be made. */
const jobs = [];
for (const pack of only) {
  const prompts = JSON.parse(readFileSync(join(PROMPTS, `${pack}.json`), "utf8"));
  for (const s of manifest) {
    if (names.length && !names.includes(s.name)) continue;
    if (!prompts[s.name]) {
      console.log(`${pack}/${s.name}: no prompt, skipped`);
      continue;
    }
    for (let i = 1; i <= s.count; i++) {
      const file = join(OUT, pack, s.count > 1 ? `${s.name}-${i}.mp3` : `${s.name}.mp3`);
      if (existsSync(file) && !force && !names.length) continue;
      jobs.push({ pack, file, label: `${pack}/${s.name}${s.count > 1 ? `-${i}` : ""}`, body: { text: prompts[s.name], duration_seconds: s.seconds, prompt_influence: s.influence ?? 0.5, loop: !!s.loop, model_id: "eleven_text_to_sound_v2" } });
    }
  }
}

let made = 0;
let failed = 0;
async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    mkdirSync(join(OUT, job.pack), { recursive: true });
    try {
      await run("elevenlabs", ["text-to-sound-effects", "convert", "--json", JSON.stringify(job.body), "--output-format", "mp3_44100_96", "-o", job.file, "--quiet"]);
      made++;
      console.log(`${job.label} ok`);
    } catch (e) {
      failed++;
      console.log(`${job.label} FAILED ${String(e.stderr ?? e.message).slice(0, 160)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`${made} file(s) generated${failed ? `, ${failed} failed (run again to retry)` : ""}`);
