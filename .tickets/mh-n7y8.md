---
id: mh-n7y8
status: in_progress
deps: [mh-5c1t]
links: []
created: 2026-10-05T03:44:16Z
type: feature
priority: 2
assignee: cc-vps
parent: mh-uwgh
tags: [companions, animation, 3d]
---
# Companion animation engine: motion primitives, effect glyphs, 18 reactions x 10 companions, dev lab

Part of epic mh-uwgh (decisions D4, D10, D12).

## Why
Companions are single 2D images, yet pokes, emotes and pick-up must all look like reactions with personality. 18 reactions x 10 companions = 180 rows is too many to hand-animate, so we build a small procedural engine once, and describe each reaction as data: shared motion primitives + a per-companion body style + a few signature overrides. This also lets the human review all reactions on a dev page instead of hunting for them in a game.

## Context
- src/client/table/TableScene.tsx CompanionFigure (~line 311): `<sprite>` with scale [PET_SIZE,PET_SIZE,1], center [0.5,0.06], inside a `body` group animated in useFrame (breath scale + hop from petMotion.hopFade). A THREE.Sprite always faces the camera and can only be translated, scaled and rotated in the image plane (material.rotation); no flips around Y. Plan motions within that constraint. Replacing Sprite with a billboarded mesh is allowed only if clearly needed.
- src/client/table/petMotion.ts: pure timing helpers + tests; follow this pattern (pure functions in a .ts file, three.js wiring in TableScene). tests/ has examples.
- src/client/table/textures.ts has canvas-drawn textures (glowTexture, spriteTexture, hueTexture): use the same technique to draw effect glyphs, no image files.
- reducedMotion() exists and must be honoured.
- CompanionDef.moves (renamed from `emotes` in the kit ticket) lists each companion's planned signature animations, e.g. Hex: Loaf, Knock a token off, Tail-star twirl, Slow blink; Cinder: Sneeze (fire puff), Flap hover, Pout with smoke, Curl up; Foil: Hug the card, Cape flourish, Nibble the pack, Faint on a bad pick. Seed the signature overrides from these.

## The 18 reaction slots (same for every companion)
hello | poke1 curious | poke2 happy | poke3 affectionate | poke4 playful | poke5 bothered | poke6 pestered | poke7 finale | sulk (post-finale) | pickup | carry (loop) | drop | emote1 cheer | emote2 love | emote3 oops | emote4 silly | emote5 sass | emote6 taunt.

## Work
1. Pure motion layer (src/client/table/petMotion.ts or sibling): a Pose {dx, dy, scaleX, scaleY, rot, (alpha)}; ~14 primitives as pure `(t01, params) -> Pose`: hop, boing (squash-stretch), rock/tilt, shake, spin (in-plane roll), puff (scale pop), flatten, droop, lean/nod, wiggle, float, faint, vibrate, duck/hide. Non-loop reactions start and end at the rest pose.
2. Reaction descriptor type: {duration, loop?, motions:[{prim, at, dur, params}], fx:[{glyph, at, params}]}. A shared default table for the 18 slots; per-companion `style` (bounce, speed, amplitude, stiffness, anchor) that scales primitives; per-companion overrides (partial reaction per slot), >= ~4 hand-authored signature moves per companion drawn from `moves` (for the poke7 finale, two emotes, and drop at minimum) so companions don't feel like re-skins.
3. Effect glyphs (~12, canvas-drawn sprites that rise/fade/pop, pooled and bounded): heart, sparkle, sweat drop, anger mark, zzz, music note, stars/dizzy, smoke puff, !, ?, tear, plus species-flavoured ones as needed (flame puff, leaf).
4. Playback: a small store/hook `playReaction(playerId, slot)`; CompanionFigure composes: idle breath + turn-start hop (keep existing behaviour) + the active reaction; a new reaction interrupts the previous one cleanly (no pose pops: blend over ~80 ms); `carry` loops until stopped. API must work for any player's companion, not just the viewer's.
5. Reduced motion: no transforms; keep effect glyphs minimal or off; everything else (sound, bubble) is unaffected.
6. Dev lab at /dev/companion-lab (mirror how /dev/sound-studio is routed): a companion picker, a variant slider, and a button per reaction slot, rendering the real CompanionFigure on a plain background; this is the human review surface and the agent's verification surface (screenshots).
7. Tests: for every primitive and every reaction of every companion: finite values, rest pose at start/end for non-loops, deterministic, durations within sane bounds (<= ~3 s except loops).

## Acceptance Criteria

- The lab page plays all 18 reactions for all 10 companions with no console errors and without any pose pop at start/end; interrupting mid-reaction blends cleanly.
- Each companion has a visible body style and >= 4 signature overrides; a reviewer can tell two companions' finales apart.
- Existing idle breath and turn-start hop still work unchanged.
- reducedMotion() disables transforms.
- Effect glyphs are pooled/bounded: 4 companions reacting at once stays smooth (note frame behaviour in the PR).
- Pure-function tests cover primitives and the 180 reaction rows (see Work 7); `npm run typecheck` and `rtk vitest run` pass.
- Screenshots/short capture of the lab in the PR; the human has reviewed the reactions on the lab page and approved or requested tweaks (recorded in ticket).


## Notes

**2026-10-05T16:50:22Z**

Implemented (agent): pure engine src/client/table/companionMotion.ts (19 primitives, 8 glyph motions, advanceTrack 80 ms blend, fxSpawns), data src/client/table/companionReactions.ts (DEFAULT_REACTIONS for 18 slots, BODY_STYLES, SIGNATURES: 5-6 per companion named after roster moves, incl. every poke7 finale and >=2 emotes), playback src/client/table/companionPlayback.ts (playReaction/stopReaction keyed by playerId, time-scalable clock for the lab), CompanionFigure.tsx extracted from TableScene (idle breath + turn hop unchanged; reactions play even when the owner is offline; 14 canvas glyphs in textures.ts, fixed pool of 8 sprites per figure). Lab: /dev/companion-lab. Tilting prims lift the body by 0.25*|sin(rot)| so a fallen companion doesn't sink into the table. PENDING: human review of the reactions in the lab (approve or request tweaks), recorded here when given.

**2026-10-05T17:16:20Z**

Review feedback addressed (agent, user said 'sure go ahead' to fixing all five): (1) roll snap on interrupt near upside down fixed in advanceTrack (continuous target roll, nearest-turn start); (2) interrupt tests check every frame of the blend over every cut point, plus a deterministic regression that fails on the old engine (2.98 rad at frame 33); (3) fxSpawns skips expired glyphs and the figure dates glyphs from their scheduled time; (4) lab reel button no longer sticks on Stop; (5) signature drops added for cinder, sprout, wick, hex, test now requires drop. Human review of the lab still PENDING.
