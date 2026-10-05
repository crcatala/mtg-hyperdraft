---
id: mh-24bx
status: open
deps: [mh-ciu5, mh-5c1t]
links: []
created: 2026-10-05T03:44:16Z
type: feature
priority: 2
assignee: cc-vps
parent: mh-uwgh
tags: [companions, audio, client]
---
# Companion voice bank: lazy per-companion playback, lobby hello, sound-studio tab

Part of epic mh-uwgh (decisions D5, D6, D11-adjacent).

## Why
Every later feature (poke, emote, pickup/drop) needs a way to play "companion X's sound for slot Y" with correct volume/mute behaviour, positional feel and variant pitch. This ticket builds that runtime once, wires the first visible use (the lobby character-select hello, which is what the user asked for: "when selected during lobby as I cycle through them") and gives the human a place to audition everything.

## Context
- src/client/sfx.ts: decoded sample bank keyed by pack, analyze()/isAudible()/normalizeGain() in sfxMath.ts (trim leading silence, loudness-match), play() with gain/rate/pan, everything through sfxBus -> compressor -> master; mute and volumes (volume.ts) already apply to that bus; installSfxWarmUp() unlocks audio on first interaction. Study loadPack()/play() and reuse the same decode path rather than duplicating it.
- Voices are deliberately NOT in the sound packs (D6): they live at public/sfx/companions/<id>/<slot>.mp3 or <slot>-1/-2.mp3 (see the spike ticket, Hex's files already exist) and never change when the player switches pack.
- src/client/components/CharacterSelect.tsx: tiles with hover/focus "peek" -> CompanionPreview (the big image). src/client/hoverIntent.ts exists for debouncing hover.
- src/client/screens/SoundStudio.tsx (+ soundStudio.ts, tests/soundStudio.test.ts): /dev/sound-studio audition page.
- Hue variants: companionVariant on Player, variantHue() in roster.ts.

## Work
1. A voice bank module (e.g. src/client/companionVoice.ts, reusing sfx.ts internals; export what is needed from sfx.ts): `loadVoice(companionId)` fetches+decodes all of one companion's slots once (idempotent, cached, failures leave that slot silent); `playVoice(companionId, slot, { variant, pan, gain })` plays through the existing bus and picks among takes without immediate repeats (pickTake). A missing slot is a silent no-op that still emits an event (like play() does) - no synth fallback needed.
2. Variant pitch: pure, tested `variantPitch(variant)` -> playbackRate, deterministic per variant (variant 0 = 1.0), spread over roughly +/-3 semitones using golden-ratio-style steps like variantHue, plus +/-3% random jitter per play.
3. Loading policy: nothing loads before audio is unlocked; on the table, load voices for every companion present when the table mounts; in the lobby load the hovered/selected companion on demand (first hover may play a beat late; that is acceptable, but must not throw or double-play).
4. Lobby: playing happens when a companion tile is selected (click) and when it is hovered/focused for a moment (use hoverIntent so sweeping across the grid does not machine-gun; never overlap more than one hello). The big preview image does a short happy bounce in sync (CSS, disabled under reduced motion). Selecting "No companion" plays nothing. Replace the "It's a picture for now; 3D versions are planned" blurb with accurate copy if touched.
4b. Respect `variant` in the lobby too (the preview shows the player's variant colour; use its pitch).
5. Sound studio: add a Companions tab that lists companion x slot, shows the slot's speech line (from the kit, once it exists), has play buttons, and flags missing files. Keep to the tab/style conventions already in SoundStudio.tsx.
6. Tests: variantPitch; take selection; a file-existence test that for every companion that HAS a public/sfx/companions/<id>/ directory all kit slots exist (so partial companions fail loudly and absent ones are allowed until the generation ticket finishes).

## Acceptance Criteria

- playVoice/loadVoice exist, obey master + effects volume and mute (verified manually: mute button silences voices; effects slider scales them).
- Switching the sound pack never changes companion voices.
- Lobby: hovering/selecting a companion with audio plays its hello once, with the preview bounce; rapid sweeping across tiles does not stack sounds; no console errors when a companion has no audio yet.
- Two copies of the same companion with different variants audibly differ in pitch (variantPitch unit-tested, variant 0 == 1.0).
- Sound studio Companions tab lists all slots and plays them; missing files are flagged.
- No audio is requested before the first user interaction; each companion's files are fetched at most once.
- Verified in a real browser (agent-browser) with a short note/screenshot in the PR. `npm run typecheck` and `rtk vitest run` pass.

