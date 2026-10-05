---
id: mh-lhxh
status: in_progress
deps: [mh-kqys]
links: []
created: 2026-10-05T19:21:51Z
type: feature
priority: 2
assignee: cc-vps
parent: mh-uwgh
tags: [companions, table, ui, protocol]
---
# Customize your emote wheel's lines (this tab only, in memory)

Part of epic mh-uwgh (decisions D1, D3, D9, D12). Follows mh-kqys (emote wheel); comes BEFORE mh-5mz2 and the rest of the epic.

## Why
Players want to say their own thing: personal smack talk, in-jokes, a running gag. The six stock lines per companion are fun, but letting each player rewrite their wheel's text makes emotes a real social channel. It's deliberately light: no accounts, no storage, no moderation.

## Decisions (from the human, 2026-10-05)
- Each player can replace the TEXT of any of their 6 emote slots. The slot's tone, icon, colour, voice sound and reaction stay the same (D3: fixed slots).
- In memory only, for that browser tab: nothing in localStorage/sessionStorage/IndexedDB, nothing on the server or in room state. Closing or reloading the tab resets to the companion's defaults.
- Reached from a small button near the wheel (icon + short label). It opens a dialog to edit any of the 6 lines, with "Reset to defaults".
- A line can't be empty; whitespace is stripped; no line breaks; must be safe against XSS/markup injection. **No content filter**: it's meant for smack talk among friends (the human's explicit call; D12's "playful" rule applies to OUR stock lines, not player-written text).

## Context
- Wheel: src/client/table/EmoteWheel.tsx (+ geometry in emoteWheel.ts, flow in companionEmote.ts). The wheel's CENTRE is reserved for mh-5mz2's "Home" button, so the customize button goes elsewhere (e.g. a small pill just under the ring, where the line preview shows today, or attached at the rim). Keep it out of the wedges' hit areas.
- Bubbles are DOM (src/client/table/SpeechBubbles.tsx) and render text as React text nodes, so markup is already inert there. The wheel's aria-labels and line preview also go through React. Never use dangerouslySetInnerHTML/innerHTML for these strings, anywhere (including any future live region from mh-ntsj).
- Today the `emote` message carries only {slot}; receivers look the line up in the kit. Custom text must travel WITH the emote so other players see it: other tabs don't have your custom lines.
- Dialog pattern: follow an existing modal (Settings or an `ask` dialog, see TableScreen.tsx / styles.css .modal-backdrop) for focus trap, Esc to close, and keyboard handling. While it's open the table's shortcuts must stand down (shortcutsBlocked()) and the wheel stays closed.

## Work
1. Shared sanitizer (pure, src/shared/, used by client AND server), e.g. `cleanEmoteText(s): string | null`:
   - replace any whitespace run (incl. \r \n \t, NBSP, other Unicode spaces) with one space, then trim;
   - strip control characters (C0/C1) and invisible/bidi-override characters (U+200B-U+200F, U+202A-U+202E, U+2060-U+2069, U+FEFF) so text can't hide or reorder itself;
   - return null when empty or longer than EMOTE_TEXT_MAX after cleaning (suggested: 60 chars, a named constant; the large bubble wraps fine at that length);
   - do NOT HTML-escape: escaping is React's job at render time (pre-escaping would show "&lt;" literally).
2. Client store (in companionEmote.ts or a small module): `customLines: (string | null)[6]` in a plain zustand store with NO persist middleware; setCustomLines / resetCustomLines. A slot's effective line = custom ?? kit default for your current companion.
3. Wheel: a small button near the ring, e.g. pencil icon + "Edit lines" (accessible name "Customize emote lines"), reachable by keyboard from the wheel (a Tab stop after the 6 wedges, and/or a key such as E, shown as a hint). The wedges' preview line and aria-labels show the effective (custom) text.
4. Dialog "Your emote lines": one row per slot in wheel order, with the slot's icon + tone label + a single-line text input (prefilled with the effective line, the default shown as placeholder), a live character counter, and an inline error when a line is empty or too long after cleaning. Paste with line breaks becomes spaces. Buttons: Save (disabled while any row is invalid), Cancel, "Reset to defaults" (all six). Optional: per-row reset. Note under the inputs: "Only on this tab: lines reset when you close or reload it."
5. Protocol: `emote` gains optional `text` (zod: string, max ~2x EMOTE_TEXT_MAX raw so the cleaner decides). The server runs cleanEmoteText; if it returns null, it drops the whole emote (a cooldown slot is NOT consumed). Otherwise it relays {t:"emote", by, slot, text?} with the CLEANED text. Still STATELESS and never stored; same cooldown. The ServerMessage type gains `text?`.
6. Sending: when the slot has a custom line, the sender shows it locally and sends {slot, text}; no text means the kit default. Receivers show `text` if present, else the kit line. Voice and reaction are unchanged.
7. Solo/local mode: works locally (the local Room runs the same cleaner).
8. Tests: the cleaner (whitespace runs, newlines/tabs, control/bidi chars, empty, max length, "<img src=x onerror=alert(1)>" comes back unchanged, i.e. not escaped and inert when rendered), protocol schema (text optional/too long/wrong type), room relay (cleaned text relayed, invalid text dropped without consuming the cooldown, `by` stamped, state unchanged), client store (set/reset; never touches localStorage/sessionStorage: assert with spies), SpeechBubbles renders a markup-looking line as literal text (no element injected).

## Out of scope
Persistence of any kind, content filtering/moderation, per-companion line sets, custom sounds, sharing line sets.

## Acceptance Criteria

- A small, clearly labelled button near the open wheel (not in its centre, not over a wedge) opens a "Your emote lines" dialog; keyboard reachable; Esc/Cancel closes without changes.
- The dialog edits any of the 6 lines; Save applies them; "Reset to defaults" restores the companion's stock lines; empty (after stripping) or over-long lines can't be saved and say why; line breaks can't be entered (pasted ones become spaces); leading/trailing and repeated whitespace is stripped.
- Picking a customized emote shows the custom text in the large bubble for the sender AND every other player (verified with two browser sessions); voice, reaction, icon and colour are the slot's usual ones; un-customized slots still show the defaults.
- Custom lines live only in that tab's memory: reload/close resets them; nothing is written to localStorage/sessionStorage/IndexedDB, the room state or the server (verify in devtools + tests).
- Markup and script in a line render as literal text everywhere (bubble, wheel preview, aria-labels) for every player, e.g. `<img src=x onerror=alert(1)>` shows as typed and runs nothing; the server re-cleans relayed text with the same shared function and drops invalid text; `by` can't be spoofed.
- No content filter (by design).
- Works in solo/local mode. Unit tests for the cleaner, schema, relay and store as listed. `npm run typecheck` and `rtk vitest run` pass; verified with agent-browser, screenshots in the PR (wheel button, dialog incl. a validation error, custom line seen by both players, reset).


## Notes

**2026-10-05T20:39:56Z**

Implemented (agent): shared/emoteText.ts cleanEmoteText (whitespace runs -> one space, trimmed; strips Cc/Cf/lone surrogates incl. the listed bidi/zero-width ranges, keeping a ZWJ only between emoji so joined emoji survive; null when empty or > EMOTE_TEXT_MAX 60 code points; no escaping). Protocol emote {slot, text?} (raw max 120); Room cleans and drops invalid text before the cooldown, relays {by, slot, text?}. Client: table/emoteLines.ts (plain zustand, no persist; equal-to-default stored as null so it isn't sent), EmoteLinesDialog.tsx (rows with icon/label/input/counter/per-row reset, inline errors, Save disabled while invalid, Reset to defaults resets the form, Cancel/Esc/backdrop discard, pasted line breaks become spaces, focus trap, shortcutsBlocked). Wheel: 'Edit lines' pill under the ring (E, or Tab after the 6 wedges); preview + aria-labels use the effective line. Verified in two browser sessions (room G9U6UQW): custom line seen by both, markup literal for both (0 alerts, 0 injected nodes), 60-char line wraps, reset, reload resets, no storage written; solo works. OPEN: human review.

**2026-10-05T21:08:37Z**

Review fixes (agent; user said 'sure go ahead'): (1) the Edit lines pill and hovered line now go over the ring only when there's less room below than above (wheelExtrasAbove, tested); before, a ring at the top of a short window (1280x360) put them off screen; (2) under 480 px the dialog footer wraps with Reset to defaults on its own line, so Save no longer runs off the dialog below ~355 px. Verified at 1280x360 and at 320/360/430/800 px wide.
