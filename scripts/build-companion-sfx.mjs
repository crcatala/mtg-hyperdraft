// Generates companion voice CANDIDATES with the ElevenLabs sound-effects API, for a human to audition.
// Candidates are never committed (scripts/roster/voice-candidates/ is gitignored); the chosen takes are
// copied by hand to public/sfx/companions/<id>/<slot>.mp3 (or <slot>-1/-2.mp3 for several takes).
//
//   node scripts/build-companion-sfx.mjs hex                       # every slot of one companion, 3 candidates each
//   node scripts/build-companion-sfx.mjs hex hello poke1           # only these slots
//   node scripts/build-companion-sfx.mjs hex poke7 --candidates 5  # more takes of a slot
//   node scripts/build-companion-sfx.mjs                           # every companion in the kit
//   node scripts/build-companion-sfx.mjs hex hello --force         # regenerate files that already exist
//
// What a companion sounds like is its "voice" signature in src/shared/companionKit.json (the same file the game
// reads its speech lines from); what each slot is (hello, poke1..7, pickup, drop, emote1..6) is the shared emotion
// descriptor + length in its "voice.slots". Prompt = signature + ": " + emotion + ". " + suffix. Existing candidates are skipped unless --force.
// Then `node scripts/build-voice-audition.mjs` writes the audition page next to the candidates.
//
// Needs the `elevenlabs` CLI (npm i -g @elevenlabs/cli) and ELEVENLABS_API_KEY.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "roster", "voice-candidates");
const CONCURRENCY = 5;

const kit = JSON.parse(readFileSync(join(ROOT, "src", "shared", "companionKit.json"), "utf8"));
const { slots, suffix } = kit.voice;
const voices = Object.fromEntries(Object.entries(kit.companions).map(([id, c]) => [id, c.voice]));

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const ci = argv.indexOf("--candidates");
const candidates = ci >= 0 ? Number(argv[ci + 1]) : 3;
if (!Number.isInteger(candidates) || candidates < 1) throw new Error("--candidates needs a positive integer");
const words = argv.filter((a, i) => !a.startsWith("--") && (ci < 0 || i !== ci + 1));
const ids = voices[words[0]] ? [words.shift()] : Object.keys(voices);
for (const s of words) if (!slots[s]) throw new Error(`unknown slot "${s}" (slots: ${Object.keys(slots).join(", ")})`);
const only = words.length ? words : Object.keys(slots);

/** Every (companion, slot, candidate) that should be made. */
const jobs = [];
for (const id of ids) {
  for (const slot of only) {
    const { emotion, seconds, influence } = slots[slot];
    for (let n = 1; n <= candidates; n++) {
      const file = join(OUT, id, `${slot}-${n}.mp3`);
      if (existsSync(file) && !force) continue;
      jobs.push({ id, file, label: `${id}/${slot}-${n}`, body: { text: `${voices[id]}: ${emotion}. ${suffix}`, duration_seconds: seconds, prompt_influence: influence ?? 0.5, loop: false, model_id: "eleven_text_to_sound_v2" } });
    }
  }
}

let made = 0;
let failed = 0;
async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    mkdirSync(join(OUT, job.id), { recursive: true });
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
if (failed) process.exitCode = 1;
