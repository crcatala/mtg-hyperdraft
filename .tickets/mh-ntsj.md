---
id: mh-ntsj
status: open
deps: [mh-2rwl, mh-x519, mh-kqys, mh-5mz2]
links: []
created: 2026-10-05T03:45:29Z
type: task
priority: 2
assignee: cc-vps
parent: mh-uwgh
tags: [companions, polish, settings, docs]
---
# Companions polish: Settings toggles, a11y, reduced motion, perf, docs, final audit

Part of epic mh-uwgh (decisions D11, D12). Do this last, once pokes, emotes and pick-up exist and all voices are in.

## Why
Playful trolling needs an off switch, the new interactions need to be accessible, and the epic's numbers (150 lines, 160 sounds, 180 reactions) should be audited against what shipped so nothing is silently missing.

## Context
- src/client/components/SettingsDialog.tsx: existing volume/music/theme settings and how they persist (volume.ts, soundPacks.ts, theme.ts use localStorage with try/catch).
- All companion voice and bubble playback should already go through single functions (poke ticket); gate them there.
- README.md documents features; src/client/components/CharacterSelect.tsx has copy about companions.

## Work
1. Settings: two local toggles, "Companion sounds" and "Companion speech" (persist per browser, default on). Sounds off: no voice playback (reactions still animate). Speech off: no bubbles (sounds/animation remain). They affect only what the local player sees/hears; they never change what is sent. Provide a quick way to reach them (e.g. a link from the emote wheel or the audio controls) if cheap.
2. Reduced motion pass across lab, table, lobby preview.
3. Accessibility: emote wheel fully keyboard-operable and labelled (verify focus handling), a keyboard shortcut to open the wheel for your own companion if it doesn't conflict with existing shortcuts (src/client/shortcuts.ts), emote bubbles announced politely via a visually hidden live region (and gated by the speech toggle), poke bubbles not announced.
4. Performance sanity: 4 players spamming pokes/emotes does not stall the frame rate, leak listeners/textures/audio nodes, or trip flood control for normal human speeds. Fix leaks found.
5. Docs: README section on companion interactions and how to regenerate voices (scripts/build-companion-sfx.mjs); update stale copy.
6. Final audit: a small test or script that prints the actual counts (voice slots/files, lines, reactions per companion) and asserts they match the epic's inventory; list anything missing in a ticket note.

## Acceptance Criteria

- Both toggles exist, persist, take effect immediately, and are verified by hand (sounds off = silent but animated; speech off = no bubbles).
- Wheel is keyboard-operable and screen-reader-labelled; reduced motion verified on table, lobby and lab.
- No growth in audio nodes/textures/listeners after sustained spamming (checked and noted in the PR).
- README updated; stale "picture for now" copy removed.
- The audit confirms 10 companions x (16 voice slots, 15 lines, 18 reactions) = 160 / 150 / 180 and passes in CI.
- `npm run typecheck` and `rtk vitest run` pass; verified with agent-browser, screenshots in the PR.

