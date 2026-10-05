---
id: mh-ciu5
status: in_progress
deps: []
links: []
created: 2026-10-05T03:43:31Z
type: task
priority: 1
assignee: cc-vps
parent: mh-uwgh
tags: [companions, audio, spike]
---
# Spike: generate and audition Hex's 16 voice sounds (go/no-go for companion voices)

Part of epic mh-uwgh (read its Key decisions D5-D8 first).

## Why
The riskiest assumption in the whole epic: that ElevenLabs text-to-sound-effects can produce CUTE, NON-VERBAL creature vocalizations (whimpers, babbles, chirps with emotion), not generic animal noises or garbled speech. Everything else (160 lines of text, the voice bank, 9 more companions' audio) is wasted effort if it can't. This spike costs ~48 generations for one companion and gives a human go/no-go before anything else is built.

## Context
- scripts/build-sfx.mjs is the pattern to imitate (shells out to `elevenlabs text-to-sound-effects convert --json {text,duration_seconds,prompt_influence,loop,model_id:"eleven_text_to_sound_v2"} --output-format mp3_44100_96 -o <file>`; concurrency 5; skips existing files unless forced). The CLI is installed and ELEVENLABS_API_KEY is set in the environment. Do not print the key.
- Hex = Witch's Cat (src/shared/roster.ts): "Aloof, curious, loves sitting on whichever card you were about to read." Chosen because cats have a rich, recognisable vocal range and a strong personality, so failures are easy to hear.
- An agent cannot judge audio quality by listening. The human (the repo owner) must audition. You can only do objective sanity checks (non-silent, duration, no clipping) e.g. with analyze()/isAudible() from src/client/sfxMath.ts.

## The 16 voice slots (identical for every companion; Hex is the first)
hello (friendly lobby greeting) | poke1 curious | poke2 happy | poke3 affectionate | poke4 playful | poke5 bothered | poke6 pestered | poke7 indignant cheeky finale | pickup (surprised lift: "whoa!") | drop (landing: relieved/happy "oof") | emote1 cheer | emote2 love | emote3 oops | emote4 silly | emote5 sass | emote6 taunt.
Each slot = a shared EMOTION descriptor (reusable for every companion) + a per-companion VOICE SIGNATURE (e.g. for Hex: a small cute witch's-cat, soft high mews, trills and purrs). Prompt = signature + emotion + "short, no words, no music, dry, close-up" (see how existing prompts end). Target 0.5-1.5 s per sound (finale and a couple of emotes may reach ~2 s).

## Work
1. Write scripts/build-companion-sfx.mjs, designed for ALL companions, not just Hex: reads scripts/roster/voices.json ({ voices: {<companionId>: "<signature>"}, slots: {<slot>: {emotion, seconds, influence}} }); usage `node scripts/build-companion-sfx.mjs [companionId] [slot...] [--candidates N] [--force]`; writes candidates to scripts/roster/voice-candidates/<id>/<slot>-<n>.mp3 (default N=3; skips existing unless --force; add that directory to .gitignore - candidates are never committed). Header comment documents usage like build-sfx.mjs does.
2. Before generating, check the ElevenLabs plan's remaining credits and the credit cost of one sound-effect generation (CLI or API), and record both in a ticket note. Stop and ask if 48 generations would use an unreasonable share of the quota.
3. Generate Hex x 16 slots x 3 candidates (48 files).
4. Make auditioning easy for the human: a minimal page served by the existing `npm run dev` server (candidates + page must stay out of git) that lists every slot with its emotion, the 3 candidates as <audio controls>, and a radio to mark the pick. The human may reach the dev server remotely, so confirm how they open it (ask if unsure).
5. Run objective checks on all 48; discard silent/clipped/too-long files and regenerate those.
6. After the human picks, copy the 16 chosen files to public/sfx/companions/hex/<slot>.mp3, plus a second take (<slot>-2.mp3) for hello, poke1 and poke2 (use the next-best candidate), then commit voices.json (with Hex's signature and the 16 slot descriptors in their FINAL, proven wording) and public/sfx/companions/hex/.
7. Write findings with `tk add-note`: credits used, per-slot hit rate (how many of 3 candidates were usable), which prompt phrasings worked / failed, and a recommendation. If quality is poor try (and report) in this order: reword toward "cartoon / plush toy / cute"; raise prompt_influence; generate with ElevenLabs TTS on nonsense syllables for the babble-type slots; pitch-shift/layer. Do not silently drop to a worse outcome: the human decides.

## Design

File layout decided for the epic: candidates (gitignored) scripts/roster/voice-candidates/<id>/<slot>-<n>.mp3; shipped public/sfx/companions/<id>/<slot>.mp3 or <slot>-1/-2.mp3 when a slot has several takes (same naming rule as public/sfx/<pack>/). voices.json is the single source for signatures and slot emotions; later tickets (companion kit) may move descriptors into a shared JSON, but the wording proven here must carry over unchanged.

## Acceptance Criteria

- scripts/build-companion-sfx.mjs exists, works for any companion id and slot filter, documented in its header, candidates directory gitignored.
- A ticket note records credit balance before/after and cost per generation.
- 48 Hex candidates generated; all pass objective sanity checks (audible, sensible duration, not clipped).
- The human has auditioned them using the audition page and recorded a GO or NO-GO decision (agent adds it as a ticket note quoting the human). No dependent ticket may start before a GO.
- On GO: the 16 chosen Hex sounds (+ extra takes for hello, poke1, poke2) are committed under public/sfx/companions/hex/ and scripts/roster/voices.json contains Hex's signature and all 16 slot descriptors in proven wording.
- Findings note includes per-slot hit rate and what prompt wording worked, so the other 9 companions can reuse it.
- No API key in any committed file or output. `npm run typecheck` and `rtk vitest run` still pass.


## Notes

**2026-10-05T04:04:05Z**

WIP (agent): tooling + 48 Hex candidates done, PENDING human audition/go-no-go. Credits: key lacks user_read so the balance can't be read (GET /v1/user/subscription -> missing_permissions; usage get returns nothing). Cost measured from the character-cost response header: 5 credits for a 1 s sound-generation, so 48 candidates ~ 250-500 credits (~63 generations incl. regenerations); not an unreasonable share of any paid tier. Tooling: scripts/build-companion-sfx.mjs (generate), scripts/build-voice-audition.mjs (objective checks + audition page, --prune deletes flagged files; needs ffmpeg, FFMPEG=/path if not on PATH), scripts/roster/voices.json (hex signature + 16 slots, WORDING NOT FINAL until audition). Objective checks via analyze()/isAudible(): first pass 48/48 audible, 0 wrong duration, 7/48 had sustained flat-top clipping (poke1-2, poke4-2, poke4-3, pickup-2, drop-1, emote1-2, emote4-2); pruned+regenerated (pickup-2 and drop-1 needed 3 rounds); final 48/48 pass. Calibration finding: ElevenLabs sfx mp3s decode with peaks up to ~1.5 (shipped packs do too), so peak alone is not clipping; flat-top = run of >=8 samples at >=0.98 or >1% of samples. Audition page: <dev server>/scripts/roster/voice-candidates/audition (dev server redirects the .html URL). Subjective hit rate and which wording worked: to be recorded after the human audition.

**2026-10-05T04:18:53Z**

Human feedback (round 1, quoted): "only a few imo are usable.. issue with most is they are very harsh, high-pitched squeals from kitten, almost high treble". Not a decision yet; the human suggested trying a reworded prompt and/or another companion to separate prompt vs model. Round 2 experiment (4 slots hello/poke3/poke5/pickup x 2 candidates): hex-soft (reworded: chubby sleepy house cat, plush-toy cartoon, low-to-mid mews + purr, mellow, never shrill), nimbus/gloop/ribbit (same template, other creatures), hex-lowered (original hex takes pitched down ~5 st + lowpass 5 kHz, no credits). Objective: share of energy above 4 kHz over those slots: hex 38% mean (max 72%), hex-soft 5%, hex-lowered 19%, nimbus 0.3%, ribbit 3.3%, gloop 25%. So the treble is mostly our wording (kitten/high-pitched mews), not the model. Note: --prune removed 16 of the 32 new files unheard (flat-top clipping, which may correlate with harshness); they were regenerated and kept, only flagged. Awaiting human listen to round 2.

**2026-10-05T04:24:17Z**

Human feedback (round 2, quoted): "ok it was definitely the prompt, the hex soft (reworded) sounds so much better! and the other companaion sounds are all pretty good actually (some i might want to keep). the hex-lowered didn't fix well enough the audio." Not recorded as GO yet (final picks pending). Actions: hex signature in voices.json is now the reworded wording (chubby sleepy house cat, plush-toy cartoon, low-to-mid mews + purr, mellow, never shrill, no squeals); hex-lowered dropped (post-processing pitch/lowpass is not enough). nimbus/gloop/ribbit experimental signatures kept in voices.json for mh-2rwl. Full Hex set regenerated (16 slots x 3, 46 files: drop and emote4 have 2 because those two kept clipping, regenerated 4 rounds); old kitten takes parked in voice-candidates/_hex-kitten-v1 (gitignored). New objective check in build-voice-audition.mjs: shrill = >30% of energy above 4 kHz (old kitten 38% mean, soft wording 5%). Prompt finding: percussive landing/'oof' (drop) and goofy babble (emote4) are the slots most prone to flat-top clipping. Awaiting human audition of the full set and picks.
