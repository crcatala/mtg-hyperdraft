---
id: mh-5mz2
status: open
deps: [mh-x519, mh-kqys, mh-lhxh]
links: []
created: 2026-10-05T03:45:29Z
type: feature
priority: 2
assignee: cc-vps
parent: mh-uwgh
tags: [companions, table, protocol, state]
---
# Press-and-hold to pick up your companion; drop it anywhere off the mats; persisted and broadcast

Part of epic mh-uwgh (decisions D1, D2, D9, D12, D13).

## Why
Players want to physically move their little buddy around the table and set it down somewhere fun (next to the pile, on the table edge, by a friend). It must feel tangible (a lift, a dangle, a landing), everyone must see it moving, and it must stay where it was dropped after a reload.

## Context
- Gesture model (D2): tap = poke (poke ticket). Press-and-hold on YOUR OWN companion = pick up. Define constants: HOLD_MS (~250 ms) and a movement threshold (~8 px): a pointer-down that is held >= HOLD_MS OR moves beyond the threshold before release becomes a pick-up; a release before either is a tap = poke. For someone else's companion: no pick-up ever; a press-and-release (even if held) is just a poke.
- Dropping rule (D13): not on ANY seat's mat (all seats, with a small margin for the companion's footprint) and not outside the table. src/shared/tableLayout.ts has the geometry (localToTable/tableToLocal, MAT_W=26, MAT_D=13, tableRadius, seatCount-dependent radius). The companion's default home spot is local (-MAT_W/2 - 1.3, -MAT_D/2 + 2.4) just outside the mat's back-left corner, which must always be a valid spot. Add a pure shared function (e.g. petSpotValid(p, seatCount) / nearestValid) used by BOTH client and server, with unit tests for 1-4 seats, mat edges, the table rim, and the home spot.
- Pointer->table: tableApi.screenToTable in src/client/table/drag.ts. Existing drag streaming (`drag` message, ~20 per second, stateless) is the template for live movement. The pointer must be captured so camera controls and the card drag logic don't fire.
- Persistence: add an optional Player.companionAt {x,y} in src/shared/types.ts (table coords), set only by a validated stateful message, included in the room view so reloads/late joiners render it. This is the ONLY persisted state in the epic: one write per drop (roomWrites budget is 1/s sustained: fine). Clear it when the player changes companion or the game returns to the lobby/starts anew; check src/shared/room.ts flows (setLook, phase changes).
- Animation: `pickup`, `carry` (loop) and `drop` reactions + voices + bubbles from the engine/voice bank/bubble tickets. Keep the existing renderOrder so a carried companion draws above cards.

## Work
1. Gesture handling (pure state machine, tested): idle -> pressing -> carrying -> dropped/cancelled, with HOLD_MS/threshold constants.
2. Carry: companion lifts (scale up, soft shadow shrinks/blurs, dangle sway driven by pointer velocity), follows the pointer via screenToTable; `pickup` voice + bubble at lift. Over an invalid spot (any mat / off table) it visibly can't land (red-ish tint or head-shake) - the owner sees why.
3. Live broadcast: stream position (stateless `petMove`, <= 20/s) so other players see it travel, smoothing/interpolating on their side; others also see the lift and carry animation. Ensure a dropped connection/abandoned carry ends cleanly on others' screens (timeout).
4. Drop: valid -> landing animation + `drop` voice + bubble, send stateful `setPetPos {x,y}`; server re-validates with the shared function (reject if the sender has no companion, spot invalid, or not their own), stores companionAt, broadcastState. Invalid release -> animate back to the last valid position (or home) with a short "nope" reaction, no message sent.
5. Send home: add a "Home" button in the CENTRE of the emote wheel (wheel ticket) which clears companionAt (`setPetPos null`) and animates the companion home.
6. Rendering: position = companionAt ?? home spot; its hop/breath/reactions continue to work from wherever it stands.
7. Tests: shared geometry function, gesture state machine, protocol schema, room-level setPetPos (valid, on-mat rejection, not-your-companion rejection, no-companion rejection, cleared on companion change/new game).

## Acceptance Criteria

- Quick tap pokes; press-and-hold (or press+drag) lifts the owner's companion; non-owners can only poke.
- While carried the companion visibly lifts, dangles and follows the pointer; other players see it move smoothly; dropping on a valid spot lands it with animation and sound; dropping on any mat or outside the table sends it back with a clear cue and no state change.
- The dropped position persists across reload and for a player who joins later; one state write per drop; clearing via the wheel's Home button works; changing companion or starting a new game clears the position.
- Server rejects invalid positions and requests for companions the sender doesn't own; the shared validation function is used on both sides and covered by unit tests for 1-4 seats, edges and the home spot.
- Camera controls, card dragging and pings are unaffected before, during and after a carry; a carry abandoned by a lost connection doesn't leave a ghost on other screens.
- Works in solo/local mode; reduced motion respected (no dangle/transform fanciness but still functional).
- Verified with agent-browser in two sessions; screenshots/capture in the PR. `npm run typecheck` and `rtk vitest run` pass.

