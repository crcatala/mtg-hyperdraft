---
id: mh-5c1t
status: closed
deps: [mh-ciu5]
links: []
created: 2026-10-05T03:43:31Z
type: feature
priority: 2
assignee: cc-vps
parent: mh-uwgh
tags: [companions, content, shared]
---
# Companion kit: shared slot schema, voice signatures and all 150 speech lines

Part of epic mh-uwgh (decisions D3, D4, D5, D10, D12).

## Why
All later tickets (voice bank, animation engine, poke, emotes, drag) need one agreed, typed description of "what a companion can say and do". Putting it in one shared, tested data structure keeps the 10 companions consistent (same slots everywhere, different flavour) and gives the server and client a single source for slot ids. The 150 speech lines are the personality of the feature, and a human will review them, so they get their own deliverable.

## Context
- src/shared/roster.ts: CompanionDef {id,name,species,color,personality,emotes[]}. The existing `emotes` array (e.g. Hex: "Loaf (sit on the card)", "Knock a token off", "Tail-star twirl", "Slow blink") is a list of PLANNED ANIMATIONS. The epic introduces an emote WHEEL, so rename this field to `moves` everywhere it is used (roster.ts, scripts/roster/roster.json, CharacterSelect, tests, README) to avoid confusion. Do not rename ids.
- src/client/sfxManifest.json is the precedent for a JSON file shared by a node script and the client. Use the same approach here (src/shared/companionKit.json or similar + a typed TS wrapper) so scripts/build-companion-sfx.mjs (created in the spike) and the client read the same data. Voice signatures/slot emotions from scripts/roster/voices.json (spike) must be reconciled into the single source: do not leave two copies that can drift.
- Personalities are in roster.ts; reuse their tone.

## Work
1. Slot schema (pure, shared by client and server): POKE_STEPS = 7 (curious, happy, affectionate, playful, bothered, pestered, finale), a sulk reaction after the finale, pickup, carry, drop, hello, and EMOTE_SLOTS = 6 with fixed ids and order: cheer, love, oops, silly, sass, taunt (each with a short label and an icon id for the wheel). Export helpers for validating a slot index (used by the zod protocol schema later).
2. Per-companion kit: voice signature, speech lines {poke[7], pickup, drop, emote[6]}, and a reference to the companion's `moves`.
3. Write all 150 lines (15 x 10). Guidelines:
   - In character: use the personality/quote/species in roster.ts. Mostly cute, some funny. Companion bubbles are real English even though the sounds are babble.
   - Poke lines escalate like Warcraft/StarCraft unit clicks: 1 curious -> 2 pleased -> 3 affectionate -> 4 playful -> 5 mildly annoyed -> 6 properly fed up -> 7 the cheekiest, funniest line, then it sulks and resets.
   - Length: poke/pickup/drop <= ~36 characters; emote <= ~28 characters (they render large). Plain text; occasional action in *asterisks* is fine but keep it rare.
   - Emotes: cheer = positive, love = wholesome, oops = sympathetic/funny, silly = non-sequitur, sass = cheeky tease, taunt = playful trolling (think "too easy", never hostile; no slurs, no profanity, nothing aimed at a real person's identity or real-world traits).
   - No two lines identical within a companion; avoid reusing the same joke across companions.
4. A completeness test (tests/): every companion has every slot, all lines non-empty and within length limits, no duplicates within a companion, emote ids unique and ordered, kit ids == COMPANION_IDS, voice signature present. Update tests/roster.test.ts for the `moves` rename.
5. PR description contains a table of all 150 lines (companion x slot) for the human review, since the human will edit them.

## Acceptance Criteria

- `emotes` renamed to `moves` everywhere; no references to the old name remain; ids untouched.
- One shared data source for kit + voice signatures, readable by node scripts and TS; scripts/build-companion-sfx.mjs reads it (no duplicate descriptor copy left behind).
- All 150 lines written, meeting length and tone rules, covered by the completeness test.
- The human has reviewed the line table in the PR and approved or edited it (recorded in the ticket).
- Slot helpers exported with unit tests (index validation, counts: 7 poke, 6 emote).
- `npm run typecheck` and `rtk vitest run` pass.


## Notes

**2026-10-05T05:14:08Z**

WIP (agent): emotes->moves renamed (roster.ts, roster.json, CharacterSelect, README). Kit source of truth is now src/shared/companionKit.json (voice suffix+slot descriptors, per-companion voice signature + 15 lines); typed wrapper src/shared/companionKit.ts (POKE_STEPS=7, EMOTE_SLOTS, validators, VOICE_SLOT_IDS(16), REACTION_IDS(18)). scripts/roster/voices.json deleted; build-companion-sfx.mjs and build-voice-audition.mjs read the kit (Hex/nimbus/gloop/ribbit wording byte-identical to the spike). Signatures for foil/cinder/folio/sprout/wick/crit are NEW (same plush-toy template) and untested against the API: mh-2rwl will audition them. 150 lines written; human review of the line table in the PR is pending.

**2026-10-05T12:31:18Z**

Human review (quoted): "i reviewed all speech and look great to me, i approve." All 150 speech lines approved as written, no edits (PR #28). Voice signatures for foil/cinder/folio/sprout/wick/crit were not separately reviewed; mh-2rwl auditions them.

**2026-10-05T12:31:40Z**

Human review of the 150 speech lines (PR #28), quoted: "i reviewed all speech and look great to me, i approve". No edits requested. Voice signatures for foil/cinder/folio/sprout/wick/crit were not separately reviewed; mh-2rwl will audition the sounds.
