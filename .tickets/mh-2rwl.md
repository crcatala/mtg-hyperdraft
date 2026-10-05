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

**2026-10-05T14:29:27Z**

Human sign-off, foil (quoted): picks pasted with "verdict": "GO" ("ok these are my picks as \"GO\""). Picks (shipped <- candidate): hello-1<-hello-2, hello-2<-hello-1, poke1-1<-poke1-1, poke1-2<-poke1-2, poke2-1<-poke2-1, poke2-2<-poke2-3, poke3<-poke3-1, poke4<-poke4-1, poke5<-poke5-2, poke6<-poke6-2, poke7<-poke7-1, pickup<-pickup-2, drop<-drop-1, emote1<-emote1-1, emote2<-emote2-2, emote3<-emote3-1, emote4<-emote4-1, emote5<-emote5-1, emote6<-emote6-1 (19 files, 288 KB, public/sfx/companions/foil/). Note poke3-1 was picked although the objective check flags it as clipped; the human chose it by ear. Foil done; next: cinder.

**2026-10-05T14:30:27Z**

Cinder, generated (agent), PENDING human audition. Signature reworded before generating, applying the foil learnings: "chirrs" -> "burbling coos", added "tiny fire sputters" and "no chirps": "A chubby baby dragon with a soft warm plush-toy cartoon voice: gentle low-to-mid pitched burbling coos, rumbly purring growls and small snorting puffs with tiny fire sputters, rounded and mellow, never shrill, no chirps, no screeches". 48 gens + ~16 rerolls over 3 prune rounds (2 first-round API failures retried): final 48/48 pass objective checks, every slot 3/3 clean. Treble mean 18% (max 28%): brighter than foil (5%) and Hex (5%), probably the fire sputters; below the 30% shrill line but worth a listen.

**2026-10-05T14:34:54Z**

Human sign-off, cinder (quoted): picks pasted with "verdict": "GO" ("ok \"GO\" picks for cinder"). Picks (shipped <- candidate): hello-1<-hello-1, hello-2<-hello-3, poke1-1<-poke1-1, poke1-2<-poke1-3, poke2-1<-poke2-1, poke2-2<-poke2-3, poke3<-poke3-1, poke4<-poke4-3, poke5<-poke5-2, poke6<-poke6-3, poke7<-poke7-1, pickup<-pickup-3, drop<-drop-3, emote1<-emote1-3, emote2<-emote2-2, emote3<-emote3-2, emote4<-emote4-1, emote5<-emote5-3, emote6<-emote6-2 (19 files, public/sfx/companions/cinder/). No notes on the 18% treble mean. Cinder done; next: folio.

**2026-10-05T14:36:06Z**

Folio, generated (agent), PENDING human audition. Signature reworded before generating ("chirpy babbles" -> "burbling babbles", added the tome-mimic "growly gasps and rounded little snaps", "no chirps"): "A friendly living storybook creature with a soft warm plush-toy cartoon voice: soft papery page flutters, warm low burbling babbles, gentle growly gasps and rounded little snaps, mellow, never shrill, no chirps". 48 gens + ~23 rerolls over 4 prune rounds (1 API failure retried): 46/48 pass, 2 left flagged clipped (pickup-2, emote4-3; the other takes in those slots are clean). Treble mean 3% (max 9%).

**2026-10-05T14:50:14Z**

Human feedback, folio (quoted): picks pasted with "verdict": "GO" and "For emote6 let's reword proompt and regenerate...i found it too human like...maybe it doesn't say \"nyah nyah\" but describes a generic taunt or something suitable for this character". Picks (shipped <- candidate): hello-1<-hello-3, hello-2<-hello-1, poke1<-poke1-1, poke2<-poke2-3 (no second take picked for poke1/poke2, ships one take each), poke3<-poke3-2, poke4<-poke4-1, poke5<-poke5-2, poke6<-poke6-2, poke7<-poke7-3, pickup<-pickup-3, drop<-drop-3, emote1<-emote1-2, emote2<-emote2-1, emote3<-emote3-1, emote4<-emote4-1, emote5<-emote5-2. Folio is NOT committed to public/ yet (the voice test requires every slot once a companion dir exists): waiting on emote6. Action (agent): shared emote6 descriptor reworded: "a teasing sing-song taunt, cheeky 'nyah nyah', playful mockery" -> "a smug teasing taunt in animal sounds only, a playful mocking lilt of cheeky creature noises, not a human voice, no words". Regenerated folio emote6 (3 + 1 reroll gens; old takes parked in _folio-emote6-nyah): 3 takes, treble 2-5%, objective checks pass (the 2 flagged files on the page are older takes in other slots). Awaiting emote6 pick.

**2026-10-05T14:52:01Z**

Gloop, generated (agent), PENDING human audition. Signature: "happy wet squeaks" -> "deep gurgles and happy wet burbles", added "no squeaks" (round 2 was 25% treble, human: pretty good but a bit bright): "A cute squishy blob of mana slime with a plush-toy cartoon voice: soft round bubbly blorps, deep gurgles and happy wet burbles, warm and mellow, never shrill, no squeaks". Kept the 8 round-2 candidates (made with the old wording: hello-1/2, poke3-1/2, poke5-1/2, pickup-1/2; the human liked hello-1, poke3-1, poke5-1, pickup-2, all still on the page); generated the rest: ~40 new + ~56 rerolls over 4 prune rounds + 3 extra rounds for emote4 (goofy babble, clips most). Final 44/48 pass; flagged clipped: emote2-3, emote4-1, emote4-3 (+1); every slot has a clean take (emote4-2 only). Treble mean 14% (max 30%).

**2026-10-05T14:59:54Z**

Human sign-off, folio (quoted): "ok for folio we can go with emote6-3" (shipped emote6 <- emote6-3). Folio complete: 16 slots, 16 files + hello-1/-2 = 17 files, public/sfx/companions/folio/ (poke1/poke2 ship one take each). Human sign-off, gloop (quoted): picks pasted with "verdict": "GO" ("here's my GO picks"). Picks (shipped <- candidate): hello-1<-hello-3, hello-2<-hello-1, poke1-1<-poke1-2, poke1-2<-poke1-1, poke2-1<-poke2-1, poke2-2<-poke2-3, poke3<-poke3-2, poke4<-poke4-2, poke5<-poke5-3, poke6<-poke6-1, poke7<-poke7-2, pickup<-pickup-2, drop<-drop-1, emote1<-emote1-1, emote2<-emote2-1, emote3<-emote3-3, emote4<-emote4-1 (objective check flags it clipped; chosen by ear), emote5<-emote5-2, emote6<-emote6-3 (19 files, public/sfx/companions/gloop/). Done so far: hex, foil, cinder, folio, gloop. Next: sprout.

**2026-10-05T15:02:56Z**

Sprout, generated (agent), PENDING human audition. Two wording rounds. v1 ("gentle low-to-mid pitched coos, shy low whimpers with soft leaf rustles and rounded little mumbles ... no peeps, no screams", ~190 gens incl. 4 prune rounds): FAILED, mean treble 41% (max 84%), 21/48 still flagged after rerolls, 0 clean takes for poke3/poke6/poke7/emote6. Rustle/whimper wording is broadband and shrill. v2 (shipped in kit): "A shy chubby little mandrake root with a soft warm plush-toy cartoon voice: low-to-mid pitched coos, woody hums, rounded little mumbles and gentle grunts, mellow and breathy, never shrill, no peeps, no screams, no rustling": 48 gens + 8 rerolls (1 API failure retried), 48/48 pass, every slot 3/3 clean, treble mean 8% (max 29%). v1 takes parked in _sprout-v1-rustles (gitignored). Learning: leaf rustle / whimper / peep words are shrill; humming/grunting/mumbling words are mellow. The ticket's "tiny scream for the finale" is NOT in the wording (kept "no screams"); say if you want it in poke7. Also: test fix (companionVoice no-voice case used gloop). Total so far ~1000+ generations across foil, cinder, folio, gloop, sprout; balance unreadable.

**2026-10-05T15:03:01Z**

Correction to the previous note: running total of generations for this ticket is ~700 (foil ~190, cinder ~75, folio ~75, gloop ~100, sprout ~245), not 1000+. At ~5 credits per 1 s sound that is roughly 3,500 credits if the spike rate holds; balance still unreadable.

**2026-10-05T15:08:32Z**

Human sign-off, sprout (quoted): picks pasted with "verdict": "GO" ("Go picks for sprout"). Picks (shipped <- candidate): hello-1<-hello-3, hello-2<-hello-1, poke1-1<-poke1-2, poke1-2<-poke1-1, poke2-1<-poke2-2, poke2-2<-poke2-3, poke3<-poke3-1, poke4<-poke4-1, poke5<-poke5-3, poke6<-poke6-2, poke7<-poke7-3, pickup<-pickup-1, drop<-drop-2, emote1<-emote1-2, emote2<-emote2-3, emote3<-emote3-2, emote4<-emote4-2, emote5<-emote5-1, emote6<-emote6-2 (19 files, public/sfx/companions/sprout/). No comment on the omitted finale scream. Done: hex, foil, cinder, folio, gloop, sprout. Next: wick.
