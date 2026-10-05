---
id: mh-2rwl
status: open
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

