// Generates the Treatomancer's sounds (public/treats/sfx/<name>.mp3) with the ElevenLabs sound-effects API.
// Like companion voices they aren't part of a sound pack: the machine sounds the same whichever pack plays.
// The prompts are scripts/sfx/treats.json; the generated files are committed, so this only runs when a prompt changes.
//
//   node scripts/build-treat-sfx.mjs            # whatever is missing
//   node scripts/build-treat-sfx.mjs rumble win # regenerate these
//
// Needs ELEVENLABS_API_KEY (every sound costs credits).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "treats", "sfx");
const prompts = JSON.parse(readFileSync(join(ROOT, "scripts", "sfx", "treats.json"), "utf8"));
const names = process.argv.slice(2);
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
mkdirSync(OUT, { recursive: true });

const jobs = Object.entries(prompts).filter(([name]) => (names.length ? names.includes(name) : !existsSync(join(OUT, `${name}.mp3`))));
// The API allows only a few requests at once on smaller plans.
async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) await make(...job);
}
await Promise.all([worker(), worker(), worker()]);

async function make(name, p) {
  {
    const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_96", {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: p.text, duration_seconds: p.seconds, prompt_influence: p.influence, model_id: "eleven_text_to_sound_v2" }),
    });
    if (!res.ok) return console.log(`${name} FAILED ${res.status} ${(await res.text()).slice(0, 160)}`);
    writeFileSync(join(OUT, `${name}.mp3`), Buffer.from(await res.arrayBuffer()));
    console.log(`${name} ok`);
  }
}
