---
id: mh-uwgh
status: open
deps: []
links: []
created: 2026-10-05T03:42:54Z
type: epic
priority: 1
assignee: cc-vps
tags: [companions, epic]
---
# Epic: Living companions (voices, pokes, emotes, pick-up-and-drop)

## Why
Table companions (10 of them, see src/shared/roster.ts) are currently a static 2D sprite that breathes and hops when its player's turn starts. We want them to feel alive and to be a small, fun social channel between players:
- every companion has cute non-verbal voice sounds (whimpers, babbles, chirps) that play in the lobby character-select and on the table;
- anyone can tap a companion to poke it; repeated pokes walk through an escalating cycle of sounds + speech bubbles + reactions, ending in a cheeky outburst and a reset (think old Warcraft/StarCraft unit-click lines);
- a player can right-click their own companion for a 6-slot radial emote wheel: big, bold, in-character stock phrases (positive, cheeky, taunting) with their own sounds;
- a player can press-and-hold their own companion to pick it up and drop it anywhere on the table that is not a player mat.
All of it is cosmetic and is broadcast to every player at the table.

Companions are single 2D images, so "alive" is achieved with procedural sprite motion (squash/stretch, hop, tilt, spin...), shared effect glyphs (hearts, sweat drops, zzz...), generated audio and text. No new art is needed.

## Key decisions (and why)
D1. Anyone can poke anyone's companion; only the owner can pick up or emote. Poking others' companions is the social/funny part. Owner-only for move/emote so nobody can speak for, or relocate, someone else's companion.
D2. Tap = poke. Press-and-hold = pick up (owner only). There is NO separate "pet" action. Keeps the gesture model to two cases and avoids tap/hold/drag ambiguity. (Non-owner press-and-hold simply pokes on release.)
D3. Emote slots are fixed and identical for every companion (same 6 tones, same wheel positions = muscle memory); the TEXT, SOUND and ANIMATION of each slot are per companion. The 6 tones: cheer, love, oops, silly, sass, taunt (2 positive, 1 sympathetic-funny, 1 silly, 2 cheeky/taunting). Emote text is written per companion so each has a voice.
D4. Poke ladder is the same shape for every companion: 7 steps = curious, happy, affectionate, playful, bothered, pestered, cheeky finale; then a short sulk lockout, then reset to step 1. Same categories everywhere for consistency; what varies is the sound file, the line, and the reaction.
D5. Voice sounds are NON-VERBAL (cute whimpers, babbles, chirps that suit the creature). Speech bubbles are real English. Sounds are not speech, so bubble text and audio never have to match word for word.
D6. Companion voices are NOT part of the sound packs (public/sfx/<pack>/). A companion's voice must not change when the player switches pack. They live in public/sfx/companions/<id>/, load lazily per companion, and play through the existing SFX bus so master/effects volume and mute keep working. Voice pitch shifts per hue variant (companionVariant) so two copies of the same companion at a table don't sound identical.
D7. Audio is generated with ElevenLabs text-to-sound-effects through the `elevenlabs` CLI, exactly like scripts/build-sfx.mjs (CLI is installed; ELEVENLABS_API_KEY is set in the dev environment). Prompts are assembled from ONE voice-signature string per companion + ONE shared emotion descriptor per slot, so ~26 strings drive ~160 sounds. We generate 3 candidates per sound, a human auditions, the chosen one is committed (2 takes for the most-repeated sounds: hello, poke 1, poke 2). Generated mp3s are committed like the existing packs.
D8. Spike first: generate Hex's full set (16 sounds x 3 candidates) and get a human go/no-go BEFORE writing the 150 lines or building anything else. Whether the API gives "cute creature" rather than "real animal" is the biggest unknown.
D9. Broadcast is ephemeral relay, not game state, mirroring the existing `point`/`drag` messages (src/shared/protocol.ts, STATELESS set in src/worker/roomObject.ts): the server validates, stamps `by` itself, and relays to the other sockets; it keeps no poke state (the ladder runs on the client). Writes are the scarcest free-plan resource, and rooms hibernate. The ONLY persisted piece is a dropped companion's position (one write per drop), so reloads/late joiners see it.
D10. Animation = procedural motion on the single sprite. Shared primitives + per-companion "body style" (bounciness/speed/amplitude) + per-companion signature overrides seeded from the existing planned-animation list (CompanionDef.emotes, which we rename to `moves` to avoid clashing with the new "emote wheel"). Extra expression frames (eyes closed, angry...) are deliberately deferred.
D11. Players get Settings toggles to turn companion sounds and companion speech off locally. Taunting emotes need an off switch.
D12. Strictly cosmetic: none of this reads or writes table/game state (only Player.companionAt for position). Taunts are playful, never hostile; no slurs, nothing that targets a real person.
D13. A companion cannot be dropped on any seat's mat (every seat, not just yours) or outside the table. A bad drop animates back to its last valid spot. Server re-validates with the same shared pure function.

## Inventory (what to expect)
Per companion x 10 companions:
- Voice sounds: 16 = hello (lobby) + 7 poke + pickup + drop + 6 emote -> 160 slots, ~190 files (extra takes), ~500-600 generations to audition. About 2 MB total, ~200 KB per companion, lazy-loaded.
- Speech lines: 15 = 7 poke + pickup + drop + 6 emote -> 150 lines.
- Reactions (animation data rows): 18 = hello, 7 poke, sulk, pickup, carry (loop), drop, 6 emote -> 180 rows, composed from ~14 shared motion primitives + ~12 shared effect glyphs + ~40 hand-authored signature overrides.
- New art: 0.
Shared, one time: 6 emote icons, ~12 effect glyphs, radial wheel UI, bubble UI (small + large).

## Code map (read before starting any child ticket)
- src/shared/roster.ts: AVATARS / COMPANIONS data (ids are stored on Player: never rename or reuse). scripts/roster/roster.json holds the art prompts.
- src/client/table/TableScene.tsx: CompanionFigure (~line 311): THREE.Sprite (camera-facing; can move/scale/rotate in-plane only, no Y-flips), currently raycast-disabled; petMotion.ts has the hop timing (pure, tested).
- src/client/sfx.ts + sfxMath.ts + volume.ts + soundPacks.ts: sample bank, analyze/normalize, compressor bus, master/sfx volume, mute. scripts/build-sfx.mjs + src/client/sfxManifest.json: the generation pipeline to imitate.
- src/client/screens/SoundStudio.tsx + soundStudio.ts: dev audition page at /dev/sound-studio.
- src/client/components/CharacterSelect.tsx: lobby picker (CompanionPreview, hover/focus peek).
- src/shared/protocol.ts (zod client messages, ServerMessage), src/worker/roomObject.ts (relay, STATELESS set, flood control via src/shared/rateLimit.ts), src/client/net.ts (message switch), src/client/table/tableUi.ts (showPing/pingAt = the template for a relayed cosmetic event).
- src/shared/tableLayout.ts: seat geometry (tableToLocal, MAT_W/MAT_D, pileAt...). src/client/table/drag.ts: tableApi.screenToTable.
- src/shared/types.ts Player (companion, companionVariant); src/client/local.ts (solo/local play: new features must degrade to local-only).

## Conventions for every child ticket
- One branch + PR per ticket, title like `feat(companions): ...`; keep PRs reviewable.
- Run `npm run typecheck` and `rtk vitest run` before opening the PR; add tests for pure logic (timings, ladder, geometry, schema, relay).
- Read neighbouring code first and match its idiom, comment density and naming.
- UI/animation work must be verified in a real browser (agent-browser skill), with screenshots in the PR.
- Respect reducedMotion() everywhere motion is added.

## Ticket order
spike (voices) -> kit/content schema -> {voice bank runtime, generate other 9 voices, animation engine} -> poke -> emote wheel -> pick up/drop -> polish. Stretch: bot chatter, expression frames.

