# HyperDraft

Browser-based **Magic: The Gathering cube drafting + 3D tabletop** for up to 4 friends (plus bot drafters).

Create a lobby → share the code → import a cube (CubeCobra link or pasted list) → everyone readies up →
rip packs and draft → build decks (unlimited basics) → play on a shared freeform 3D table.

## Quick start

```bash
cd mtg-hyperdraft
npm install
npm run dev          # http://localhost:3000 — Vite + the Worker + Durable Objects, all local
```

No Cloudflare account is needed for local development: the Cloudflare Vite plugin runs the Worker and
Durable Objects inside `workerd` on your machine.

**Solo playtest:** create a lobby, press <kbd>`</kbd> (backtick) to open the debug console, click
**Solo quickstart** (imports the Vintage Cube, adds bots, readies you up). Use **Skip to table** to jump
straight to the tabletop with an auto-built deck.

**Multiple players on one machine:** open the room link with `?as=2`, `?as=3`… in other tabs — each alias
is a separate player identity (the debug console has links).

```bash
npm test             # unit tests (draft engine, import parser, deck helpers, table, room flow)
npm run typecheck    # client + worker + shared
npm run build        # production build (dist/)
```

## How it fits together

```
src/
  shared/        Pure TypeScript, no DOM/Workers APIs — unit tested
    types.ts         data model (cards, lobby config, draft, decks, table)
    importParser.ts  CubeCobra URL / plain list / "4 Name" / Arena "(SET) 123" / CubeCobra CSV
    cardSources.ts   Scryfall /cards/collection (75 per request) + fuzzy fallback, CubeCobra cubeJSON
    draft.ts         booster draft engine: packs, passing L/R/L, burns, pick timers, bots
    autopick.ts      card scoring (CubeCobra ELO + rarity + colour commitment)
    deck.ts          auto-lands (by mana symbols), auto-build
    table.ts         tabletop actions + per-player views that hide hands/libraries/face-down cards
    room.ts          whole room state machine: lobby → drafting → deckbuilding → playing
    protocol.ts      zod-validated client messages, server messages, per-player RoomView
  worker/        Cloudflare Worker + one Durable Object per room
    index.ts         POST /api/rooms (new code), /api/rooms/:code/ws (websocket → DO)
    roomObject.ts    hibernating websockets, storage persistence, alarms for pick timers, imports
  client/        React + React Three Fiber
    screens/         Home, Lobby, Draft (pack opening), Deckbuilder
    table/           3D scene, textures, drag & drop, HUD, dialogs
    debug/           debug console
```

- **The server is authoritative.** Each player only ever receives their own view: other packs, other
  hands, libraries and face-down cards are stripped server-side (`tableViewFor`, `Room.viewFor`).
- **Card data** is fetched once per lobby from Scryfall (and CubeCobra for cube links) and stored in the
  room's Durable Object. **Images** are loaded lazily by each browser straight from Scryfall's CDN; until
  an image arrives, cards are drawn from their text (name, cost, type, rules, P/T).
- **Reconnects:** your seat is remembered in `localStorage` per room, so refreshing or closing the tab
  rejoins the same seat.

## Controls (tabletop)

Press <kbd>?</kbd> on the table for the full list. Highlights: drag cards anywhere (onto piles, back to
hand), double-click to tap / play / draw, right-click for menus (counters, face down, scry, search, mill,
mulligan…), <kbd>T</kbd>/<kbd>Space</kbd> tap, <kbd>F</kbd> face down, <kbd>G</kbd>/<kbd>X</kbd>/<kbd>H</kbd>
graveyard/exile/hand, <kbd>D</kbd> draw, <kbd>U</kbd> untap all, <kbd>N</kbd> end turn, arrows/<kbd>Q</kbd>
<kbd>E</kbd>/wheel for the camera, <kbd>V</kbd> overhead view.

## Deploying to Cloudflare (Workers + Durable Objects)

Everything — static client, API and rooms — deploys as **one Worker**. Durable Objects with SQLite
storage are available on the free Workers plan.

1. **Log in once** (opens a browser to authorize Wrangler with your Cloudflare account):
   ```bash
   npx wrangler login
   ```
2. **Deploy:**
   ```bash
   npm run deploy      # = vite build && wrangler deploy
   ```
   The first deploy creates the `hyperdraft` Worker and applies the Durable Object migration (`v1`,
   `RoomDurableObject`). Wrangler prints the URL, e.g. `https://hyperdraft.<your-subdomain>.workers.dev`.
   If this is your account's first Worker, Cloudflare asks you to pick a `workers.dev` subdomain.
3. **Share the URL** with friends. That's it.

Useful afterwards:

- `npx wrangler tail` — live logs from the deployed Worker (room errors, imports).
- Custom domain: Cloudflare dashboard → Workers & Pages → hyperdraft → Settings → Domains & Routes.
- Renaming the Worker: change `name` in `wrangler.jsonc`.
- If you ever rename/remove the Durable Object class, add a new migration entry — don't edit `v1`.

## Credits & legal

Card data and images courtesy of [Scryfall](https://scryfall.com) (please respect their
[API guidelines](https://scryfall.com/docs/api)); cubes from [CubeCobra](https://cubecobra.com); mana
symbols from the MIT-licensed [Mana font](https://github.com/andrewgioia/mana). HyperDraft is unofficial Fan
Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed by Wizards.
Keep it free — don't paywall or monetize anything built on this data.

## Roadmap

- **Checkpoint 1 (done):** lobby + share codes, cube import & validation, full draft with bots/timers/
  burns, deckbuilder, freeform 3D table (zones, tap, flip, transform, counters, tokens, life, scry/search,
  mulligan, dice, log), debug console.
- **Checkpoint 2:** fully 3D pack opening with a holo shader and particles, Scryfall token art, table
  polish (box-select, card stacks/attachments, hand reordering, opponent-hand reveal, sounds on the table).
- **Checkpoint 3:** real-set drafting (rarity slots, Play Booster / classic presets), spectators, text
  chat, room expiry/cleanup.
