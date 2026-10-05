---
id: mh-2rwl
status: in_progress
deps: [mh-ciu5, mh-5c1t]
links: []
created: 2026-10-05T03:44:16Z
type: task
priority: 2
assignee: cc-vps
parent: mh-uwgh
tags: [companions, audio, generation]
---
# Generate and curate voices for the remaining 9 companions

Part of epic mh-uwgh (decisions D5, D7). Needs the spike's GO and the final voice signatures/slot descriptors from the kit.

## Why
The feature only lands if every companion sounds like itself. This is the bulk audio production: 9 companions x 16 slots, curated by a human, committed like the existing packs.

## Context
- Use scripts/build-companion-sfx.mjs (from the spike) and the shared kit data. Hex is already done and its findings note records what prompt wording worked.
- Voice direction per species (starting points, refine with the spike's learnings): Foil (pack rat): tiny squeaks, chittering; Cinder (ember drakeling): baby-dragon chirps and grumbly purr with tiny fire sputters; Folio (tome mimic): page flutters under growly gasps and snaps; Gloop (mana slime): wet bloops, gurgles, squelches; Sprout (mandrake sapling): small shy squeaks with leaf rustle (and a tiny scream for the finale); Wick (candle wisp): breathy whispers, flame flickers and soft whooshes; Crit (d20 golem): stone clacks, low rumbles, goofy grunts; Nimbus (star whale calf): airy whale-calf trills and sparkling sighs; Sir Ribbit (frog knight): croaks, ribbits, bubbly throat sounds, a tiny brave 'hup!'.
- Budget: ~9 x 16 x 3 = 432 generations plus rerolls and extra takes. Check remaining ElevenLabs credits first and tell the human the expected cost before starting.
- Only the human can judge the audio. Reuse the audition page from the spike or the sound-studio tab if it exists by then.

## Work
1. Add each companion's voice signature (if not already in the kit) and generate 3 candidates per slot.
2. Objective checks (audible, duration, clipping) and automatic rerolls of failures.
3. Human audition per companion; reroll with adjusted wording for rejects (keep a short log of what changed in ticket notes).
4. Copy chosen files to public/sfx/companions/<id>/ using the naming rule (<slot>.mp3; 2 takes for hello, poke1, poke2 as <slot>-1/-2.mp3). All slots must exist for every companion.
5. Keep the sounds distinct: a companion's 16 sounds should be recognisably the same creature, and the 10 creatures should be distinguishable from each other in a blind listen.

## Acceptance Criteria

- All 10 companions have all 16 slots (+ extra takes for hello, poke1, poke2) under public/sfx/companions/<id>/; the file-existence test from the voice bank ticket passes with every companion present.
- The human signed off on each companion's set (recorded in ticket notes).
- Total public/sfx/companions size is under ~3 MB; no single file longer than ~2.5 s.
- Loudness is consistent across companions (normalised on load by the existing analyze/normalize path; no file needs a gain hack > 2x).
- Credit usage and reroll log recorded in ticket notes. No API key committed. Candidates are not committed.


## Notes

**2026-10-05T13:54:36Z**

WIP (agent): PENDING human approval of credit spend before any generation. Plan: 9 companions (foil cinder folio gloop sprout wick crit nimbus ribbit) x 16 slots x 3 candidates = 432 generations (kit slots total 17.0 s of audio per set, so 459 s for 9 x 3); nimbus/gloop/ribbit already hold 8 round-2 candidates each (4 slots x 2), reused as-is (script skips existing files), so ~400 new. Expect ~35% flat-top clipping on first pass (worst: drop, emote4, poke7), so budget ~+40% regenerations: ~550-600 generations total. Cost: the spike measured ~5 credits per 1 s sound (character-cost header), i.e. ~2,300 credits for the base 459 s, ~3,200 with rerolls; if the account is billed at the documented 20 credits/s with a set duration it would be ~4x that. The API key lacks user_read so the balance cannot be read from here. Signatures for foil/cinder/folio/sprout/wick/crit are untested against the API. Proposed order: one companion at a time (generate, objective checks, audition page, pick, reroll rejects), starting with the 6 untested signatures' cheapest check (1 companion first) so wording problems are caught before spending on all 9.

**2026-10-05T14:02:20Z**

Human approval (quoted): "sure we can do pilot first with \"foil\"". Credit spend approved for the foil pilot only (16 slots x 3 = 48 generations + rerolls); the other 8 companions need a go after the pilot audition.

**2026-10-05T14:04:58Z**

Foil pilot, generated (agent), PENDING human audition of foil. Round 1 with the untested signature ("plump little pack rat ... gentle low-to-mid pitched squeaks, happy chitters and rounded little trills, mellow, never shrill, no piercing squeals", 48 gens): 18/48 passed objective checks, 30/48 flagged, mean treble 30% (max 85%), no clean take at all for poke2, poke7, pickup, drop. Squeak/chitter/trill words pull the model to high-pitched squeaks even with "never shrill". Reworded (now in companionKit.json): "A chubby sleepy pack rat with a soft warm plush-toy cartoon voice: low-to-mid pitched chuffs, burbling chatter and rounded little grunts, like a purring hamster, mellow and breathy, never shrill, no squeaks, no squeals". Round 2 (48 gens): mean treble 5% (max 29%), 0 shrill, but 31/48 clipped (low grunts run hot). Pruned+regenerated 3 rounds (31+20+11 gens): final 41/48 clean, every slot has >=2 clean of 3, 7 flagged clipped (hello-2 poke2-3 poke3-1 poke4-3 pickup-3 emote1-1 emote4-2) left in place, flagged on the page. Total foil gens ~158 (old squeak takes parked in voice-candidates/_foil-v1-squeaks, gitignored). Learning for the other 8: avoid squeak/chitter/trill/chirp-style words for small animals; use chuffs/burbles/grunts/purr-like, plush-toy, mellow; expect ~65% clipping on first pass with low/grunty wording, so budget ~3 reroll rounds (~3.3x gens per kept set). Tooling note: bare ffmpeg on PATH is a mise shim with no version set here; use FFMPEG=/home/mog/.local/share/mise/installs/ffmpeg/9.0.2/bin/ffmpeg.

**2026-10-05T14:22:53Z**

Human feedback on the foil pilot (quoted): "Some are pretty good. ... the ones i liked were a little deeper, not like \"baby-sounding\" shrills. we can keep his character description same but maybe adjust prompts for following - hello (more like babbling an actual hello), poke2 too squeaky, poke6 too high pitched/squeaky, poke7 too squeaky, drop too human (needs to be the chubby rat creature), emote1 too high pitched". Not a GO yet. Action (agent): signature unchanged; rewrote the SHARED slot descriptors for hello/poke2/poke6/poke7/drop/emote1 in companionKit.json (hello: low burbling babble in the rhythm of a friendly heh-lloo; poke2: low chuff + soft burbling giggle; poke6: low grumbling groan; poke7: deep huffy grunting protest ending in a raspberry; drop: thump + low animal grunt + purring sigh, chubby furry creature not a human voice; emote1: deep bouncy chuffs + rumbling burble, not high-pitched). Shared on purpose: squeak/chirp/whiny/yelp words are the likely culprit for every companion; the committed Hex files were made with the old wording for these 6 slots. Regenerated those 6 slots only (18 gens + 15 rerolls; old takes parked in voice-candidates/_foil-v2-rerolled, gitignored); other foil slots untouched. New takes: treble 0-5% (was 5-30%), 17/18 clean on objective checks (drop-2 clipped, flagged). Foil total ~190 gens.
