---
id: mh-gtgu
status: open
deps: [mh-ntsj]
links: []
created: 2026-10-05T03:45:30Z
type: feature
priority: 4
assignee: cc-vps
parent: mh-uwgh
tags: [companions, bots, stretch]
---
# Stretch: bot companions chatter (react at turn start, to pokes, occasional emotes)

Part of epic mh-uwgh. Optional; do only after the polish ticket if the human wants it.

## Why
Bots already get a companion. In solo/low-player games a silent bot companion makes the table feel empty; occasional in-character reactions would make it feel like a living table.

## Work (sketch)
Bot companions react locally on each human's client (no server messages; it does not matter that two humans see slightly different timing): a hop+hello sound at their turn start, a poke-style reaction when their player's life changes, and a rare emote at a long interval (e.g. at most one per ~60-90 s per bot, never right after a human emote). Must respect the Settings toggles and reduced motion.

## Acceptance Criteria

- Bot companions occasionally react in character, rarely enough not to annoy (documented intervals), never when the relevant Settings toggle is off.
- No network messages added; no state writes; tests for the scheduling logic.

