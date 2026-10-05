---
id: mh-kqys
status: in_progress
deps: [mh-x519]
links: []
created: 2026-10-05T03:45:29Z
type: feature
priority: 2
assignee: cc-vps
parent: mh-uwgh
tags: [companions, table, ui, protocol]
---
# Right-click emote wheel: 6 radial emotes with large bubbles, sounds and broadcast

Part of epic mh-uwgh (decisions D1, D3, D9, D11, D12).

## Why
Players want to say something to each other: cheer, be wholesome, be cheeky, troll a little. A 6-slot radial wheel on your own companion is a fast, readable, in-character channel. The emotes are meant to be bigger and bolder than poke bubbles because they are messages to other players, not reactions.

## Context
- Own companion only (D1). Right-click on a non-owned companion does nothing special (let the normal behaviour happen or just ignore it, but never open someone else's wheel).
- Emote slots are fixed and identical for all companions (D3): order and ids from the kit: cheer, love, oops, silly, sass, taunt. Text/sound/reaction per companion come from the kit, the voice bank and the animation engine.
- The table's background right-click already opens a menu ("Ping here"), TableScene.tsx ~238-250; piles and cards have their own onContextMenu that stopPropagation + preventDefault (see Pile onContext). Follow that pattern so the browser menu and the table menu never appear on top of the wheel. There is a generic context menu in store.ts (openMenu): the wheel is a separate component, do not shoehorn it in.
- Icons live in src/client/icons.ts (SVG icon system): add 6 emote icons there in the same style.
- Relay pattern, bubble component (size="large"), voice playback and reactions come from the poke ticket; reuse them.
- Rate limits: src/shared/rateLimit.ts.

## Work
1. DOM radial wheel opened at the cursor on right-click of your own companion (clamped inside the viewport): 6 wedges at fixed angles in the kit's order, each with a large icon + short label, hover highlight, big hit targets; select on click (and on release if the player right-click-drags into a wedge); Esc / click outside / right-click again closes it. Keyboard: number keys 1-6 and arrow keys while open; Enter selects. Leave the centre free (the pick-up ticket adds a "send home" button there).
2. On select: close the wheel; play locally - voice slot emote{n}, reaction emote{n}, LARGE bubble with the companion's emote line (~1.6-2x poke size, icon + text, ~3 s, bolder style/pop animation, clearly distinct from a poke bubble); send {t:"emote", slot:0..5}.
3. Protocol: zod `emote` {slot: int 0..5}; ServerMessage `emote` {by, slot}. Server: reject if the sender has no companion, stamp `by`, relay to all others, STATELESS. Receivers play the same on the sender's companion.
4. Cooldown: ~1.5 s per player enforced client-side (wedges dim during cooldown) AND the server keeps a small per-socket guard (do not rely on the global bucket alone). Emotes during a carry/drag are not allowed (the wheel can't open while holding).
5. Emotes are not written to the game log and never change table state.
6. Lines are playful: if any taunt reads as hostile when you see it in context, flag it to the human rather than shipping.

## Acceptance Criteria

- Right-click on your own companion opens the wheel with 6 wedges in the fixed order; the browser menu and the "Ping here" menu do not appear; right-click elsewhere is unchanged.
- Selecting an emote plays the companion's unique sound, reaction and large bubble for you AND all other players (verified with two browser sessions); other players cannot open or trigger your wheel.
- The large bubble is clearly more prominent than a poke bubble and readable from every seat orientation.
- Cooldown works (client dim + server guard); spam does not trip flood disconnects in normal use; server rejects invalid slots and senders without companions; `by` can't be spoofed; no room-state write per emote.
- Keyboard operation works (1-6, arrows, Enter, Esc); wedges have accessible names.
- Works in solo/local mode (local only). Unit tests for schema, cooldown logic and relay following existing patterns. `npm run typecheck` and `rtk vitest run` pass; verified with agent-browser, screenshots in the PR.


## Notes

**2026-10-05T18:58:16Z**

Implemented (agent): protocol emote {slot 0..5} / ServerMessage emote {by, slot}; Room relays to others only when the sender is seated at the table with a companion, EMOTE_COOLDOWN_MS 1200 per player, STATELESS (no write). Client: companionEmote.ts (send/receive/show, 1.5 s cooldown, wheel open state), emoteWheel.ts (pure geometry: wedges clockwise from the top in kit order, hit test, viewport clamp, arrow stepping), EmoteWheel.tsx (DOM wheel; wedges are clip-path buttons so hit areas are exactly the wedges; click, right-drag-release, 1-6, arrows/Tab + Enter, Esc / click outside / right-click again closes; owns the keyboard while open; centre left free for mh-5mz2's Home button; can't open during a card drag). Large bubble: own colour per emote + icon badge, ~1.7x poke size, 3 s, bigger pop + wobble (reduced motion: fade only). 5 new icons (love reuses heart). Verified in two browser sessions, solo, reduced motion, lab; a voice sample starts on both screens per emote. Taunt/sass lines reviewed in context: none hostile. OPEN: (1) human listening check; (2) large bubbles (like poke bubbles) are drawn in the canvas, so DOM HUD panels cover them when a companion sits near a screen corner (default solo view, opponent in 2-seat view): human to decide fix-now (DOM bubble layer) vs mh-ntsj.
