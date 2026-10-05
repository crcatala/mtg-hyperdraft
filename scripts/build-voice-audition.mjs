// Checks the companion voice candidates and writes a page to audition them:
//
//   node scripts/build-voice-audition.mjs            # every companion that has candidates
//   node scripts/build-voice-audition.mjs hex        # one companion
//   node scripts/build-voice-audition.mjs hex --prune  # also delete flagged candidates, so build-companion-sfx.mjs refills them
//
// Writes scripts/roster/voice-candidates/audition.html (gitignored with the candidates). With `npm run dev`
// running, open  <dev server>/scripts/roster/voice-candidates/audition.html . Each slot lists its emotion
// and candidates as <audio controls>, with a radio for the pick (and a second take for the slots that ship two).
// Picks survive reloads (localStorage) and "Copy picks" gives JSON to paste back to the agent.
//
// The sanity checks reuse analyze()/isAudible() from src/client/sfxMath.ts on the decoded mp3 (needs ffmpeg; set FFMPEG=/path/to/ffmpeg if it is not on PATH):
// audible, not clipped, not shrill (too much energy above 4 kHz), and a sensible length. A file that fails is flagged and should be regenerated.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, isAudible, SILENCE } from "../src/client/sfxMath.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "scripts", "roster", "voice-candidates");
const RATE = 44100;
/** Slots that ship a second take (the most repeated sounds). */
const TWO_TAKES = ["hello", "poke1", "poke2"];

const { voices, slots } = JSON.parse(readFileSync(join(ROOT, "scripts", "roster", "voices.json"), "utf8"));
const prune = process.argv.includes("--prune");
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const ids = (arg ? [arg] : Object.keys(voices)).filter((id) => existsSync(join(DIR, id)));

function check(file, wanted) {
  const buf = execFileSync(process.env.FFMPEG || "ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 28 });
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const a = analyze(data);
  let end = data.length - 1;
  while (end > a.start && Math.abs(data[end]) <= SILENCE) end--;
  const seconds = (end - a.start) / RATE;
  // Decoded mp3s overshoot 1.0 on a hot master and the client's normalizeGain scales that away, so peak alone
  // isn't clipping; sustained flat tops are (a run of samples pinned at the ceiling, or lots of them).
  let hot = 0;
  let run = 0;
  let longest = 0;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) < 0.98) {
      run = 0;
      continue;
    }
    hot++;
    longest = Math.max(longest, ++run);
  }
  // Share of the energy above 4 kHz: the first kitten prompt scored 38% on average and sounded like squeals,
  // the reworded one 5%. Anything above ~30% is shrill.
  const high = execFileSync(process.env.FFMPEG || "ffmpeg", ["-v", "error", "-i", file, "-af", "highpass=f=4000", "-f", "f32le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 28 });
  const hd = new Float32Array(high.buffer, high.byteOffset, high.byteLength / 4);
  let all = 0;
  let hi = 0;
  for (let i = 0; i < data.length; i++) all += data[i] * data[i];
  for (let i = 0; i < hd.length; i++) hi += hd[i] * hd[i];
  const treble = all ? hi / all : 0;
  const problems = [];
  if (treble > 0.3) problems.push("shrill");
  if (!isAudible(a)) problems.push("silent");
  if (longest >= 8 || hot / data.length > 0.01) problems.push("clipped");
  if (seconds < 0.15) problems.push("too short");
  if (seconds > wanted * 1.5 + 0.3) problems.push("too long");
  return { treble: Math.round(treble * 100), peak: +a.peak.toFixed(2), rms: +a.rms.toFixed(3), seconds: +seconds.toFixed(2), problems };
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
let bad = 0;
const sections = [];
for (const id of ids) {
  const files = readdirSync(join(DIR, id)).filter((f) => f.endsWith(".mp3"));
  const rows = [];
  for (const slot of Object.keys(slots)) {
    const takes = files.filter((f) => f.startsWith(`${slot}-`)).sort();
    const cells = takes.map((f) => {
      const r = check(join(DIR, id, f), slots[slot].seconds);
      if (r.problems.length) {
        bad++;
        console.log(`${id}/${f}: ${r.problems.join(", ")}${prune ? " (deleted)" : ""}`);
        if (prune) {
          rmSync(join(DIR, id, f));
          return "";
        }
      }
      const n = f.replace(/\.mp3$/, "");
      const radios = `<label><input type="radio" name="${id}/${slot}" value="${n}"> pick</label>` + (TWO_TAKES.includes(slot) ? ` <label><input type="radio" name="${id}/${slot}#2" value="${n}"> 2nd take</label>` : "");
      return `<div class="take${r.problems.length ? " bad" : ""}"><b>${n}</b><audio controls preload="none" src="${id}/${f}"></audio><small>${r.seconds}s · peak ${r.peak} · treble ${r.treble}%${r.problems.length ? " · ⚠ " + r.problems.join(", ") : ""}</small>${radios}</div>`;
    });
    if (!takes.length) continue;
    rows.push(`<section><h3>${slot} <small>${esc(slots[slot].emotion)}</small></h3><div class="takes">${cells.join("")}</div></section>`);
  }
  sections.push(`<h2>${id}</h2><p class="sig">${esc(voices[id])}</p>${rows.join("")}`);
}

writeFileSync(join(DIR, "audition.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Companion voice audition</title>
<style>
body{font:15px system-ui;max-width:1100px;margin:0 auto;padding:16px;background:#14161a;color:#e8e8ee}
h3{margin:0 0 6px}h3 small,.sig{font-weight:400;color:#9aa}section{border-top:1px solid #2a2d34;padding:12px 0}
.takes{display:flex;flex-wrap:wrap;gap:12px}.take{display:flex;flex-direction:column;gap:4px;background:#1d2026;padding:8px;border-radius:8px}
.take.bad{outline:2px solid #c55}audio{width:260px}label{margin-right:8px}
.bar{position:sticky;top:0;background:#14161aee;padding:8px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
textarea{width:100%;height:5em;background:#1d2026;color:inherit}
</style>
<div class="bar"><b>Verdict:</b> <label><input type="radio" name="verdict" value="GO"> GO</label><label><input type="radio" name="verdict" value="NO-GO"> NO-GO</label>
<button id="copy">Copy picks</button><span id="status"></span></div>
<textarea id="notes" placeholder="Notes (what sounded wrong or right?)"></textarea>
${sections.join("\n")}
<script>
const KEY="voice-audition-v2",saved=JSON.parse(localStorage.getItem(KEY)||"{}");
const inputs=[...document.querySelectorAll("input[type=radio]")];
for(const i of inputs){if(saved[i.name]===i.value)i.checked=true;i.onchange=save}
const notes=document.getElementById("notes");notes.value=saved.notes||"";notes.oninput=save;
const status=document.getElementById("status");
// Picks for companions that are not on this page (it may have been built for one companion) are kept; only the radio groups shown here are rewritten.
function save(){const o=JSON.parse(localStorage.getItem(KEY)||"{}");o.notes=notes.value;for(const i of inputs){if(i.checked)o[i.name]=i.value;else if(!inputs.some((j)=>j.name===i.name&&j.checked))delete o[i.name]}localStorage.setItem(KEY,JSON.stringify(o))}
document.getElementById("copy").onclick=async()=>{save();const t=JSON.stringify(JSON.parse(localStorage.getItem(KEY)),null,1);
 try{await navigator.clipboard.writeText(t);status.textContent="copied"}catch{notes.value=t;status.textContent="copy failed: JSON is in the notes box"}};
</script>`);
console.log(`audition page written for ${ids.join(", ") || "nobody"}${bad ? `; ${bad} file(s) flagged` : "; all files pass"}`);
