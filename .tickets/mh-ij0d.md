---
id: mh-ij0d
status: open
deps: []
links: []
created: 2026-10-06T04:10:04Z
type: bug
priority: 2
assignee: cc-vps
tags: [server, security, debug]
---
# Server: only let debug commands that affect everyone come from someone allowed to

Room.handle runs every { t: "debug" } message from any player (src/shared/room.ts, case "debug" -> Room.debug). There is no host check and no dev/solo check, in the worker or the room. Hiding the debug console behind ?debug (PR #38) only hides the buttons; any player in an online room can still send these messages from the browser console or a modified client.

Commands today:
- autoPickMe, autoBuildMe: only affect the sender. autoPickMe is also a real player feature (the draft's "Auto-pick for me" button, online too). Fine as they are.
- finishDraft: auto-picks every remaining pick for every seat, humans included, and jumps to deckbuilding.
- startGame: finishes the draft if needed, auto-builds and readies every human's deck that isn't ready, and starts the game.
- toLobby: wipes the draft, decks and table and returns everyone to the lobby. Can't be undone.

So one player can end everyone's draft or game. In practice rooms are invite-only friends, so the risk is griefing/accidents, not data exposure.

## Design

Options (pick one):
1. Host-only for finishDraft/startGame/toLobby (requireHost, as config/addBot already do). Smallest change; the host can still playtest online.
2. Allow them only in solo (in-browser engine) and local dev (e.g. a DEBUG_COMMANDS env var / wrangler var in .dev.vars), reject in production online rooms.
3. Both: host-only in dev, rejected in prod.
Keep autoPickMe/autoBuildMe open to everyone. The solo draft's "Finish the draft" button must keep working (solo mode: the player is the host).

## Acceptance Criteria

- A non-host sending finishDraft/startGame/toLobby gets an error and nothing changes (room tests).
- autoPickMe/autoBuildMe still work for any player.
- Solo "Finish the draft" and the debug console's jump buttons still work for the host / in dev.
- README's debug console note says who can use the jump buttons.

