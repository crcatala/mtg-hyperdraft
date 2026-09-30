# HyperDraft

Browser-based **Magic: The Gathering cube drafting + 3D tabletop** for up to 4 friends (plus bot drafters).

Create a lobby → share the code → import a cube (CubeCobra link or pasted list) → everyone readies up →
rip packs and draft → build decks (unlimited basics) → play on a shared freeform 3D table.

Anyone can **play solo against bots** straight away: it runs entirely in the browser, no server or sign-up.
Hosting **online rooms** for friends needs an invite code; joining a room only needs its link. Optionally,
you can also let anyone host a limited **public room** without an invite (off unless you turn it on, see
[Public rooms](#public-rooms-optional)).

## Quick start

```bash
cd mtg-hyperdraft
npm install
npm run dev          # http://localhost:3000 — Vite + the Worker + Durable Objects, all local
```

No Cloudflare account is needed for local development: the Cloudflare Vite plugin runs the Worker and
Durable Objects inside `workerd` on your machine. The first `npm run dev` copies `.dev.vars.example` to
`.dev.vars` (local secrets, gitignored), which includes a dev invite: open
<http://localhost:3000/?invite=dev-invite-key> once to be able to host online rooms locally. To try public
rooms, uncomment `PUBLIC_ROOMS_ENABLED` (and optionally the Turnstile test keys) in `.dev.vars` and restart
`npm run dev`. `.dev.vars` is only created once, so copy those lines from `.dev.vars.example` if yours is older.

**Solo playtest:** click **Play solo vs bots** on the home page, then **Quick start** (loads the bundled
Hypercube and readies you up). Press <kbd>`</kbd> (backtick) for the debug console: **Skip to table** jumps
straight to the tabletop with an auto-built deck, and **Slow-motion card animations** runs every card
animation 6× slower for tuning them. The same tools work in online rooms.

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
    importCube.ts    import pipeline (preset/CubeCobra/list → Scryfall), shared by the DO and solo mode
    presets.ts       cubes bundled as static snapshots (public/presets/*.json)
    roomCode.ts      signed room codes (HMAC check characters)
    invites.ts       invite codes, quotas, "My rooms" ledger, idle expiry
    publicRooms.ts   public room pool: slots, per-visitor rule, IPv6 /64 grouping
    rateLimit.ts     token buckets for flood control in rooms
  worker/        Cloudflare Worker + Durable Objects
    index.ts         routing, invite checks, room-code verification, kill switch
    roomObject.ts    one DO per room: hibernating websockets, storage, pick-timer alarms, imports
    inviteObject.ts  one DO per invite: room ledger, quotas, lazy expiry
    publicPoolObject.ts  the one public pool DO: slots, one room per visitor
    publicAccess.ts  hashed visitor ids, Turnstile verification
  client/        React + React Three Fiber
    net.ts           websocket transport (online rooms)
    local.ts         in-browser transport (solo mode): runs the same Room engine in the tab
    invite.ts        invite key storage, magic links, invite API calls
    publicRooms.ts   public pool status/create calls, Turnstile widget
    recentRooms.ts   rooms this browser hosted or joined, merged with the invite's for "Your rooms"
    screens/         Home (+ Your rooms), Solo, Lobby, Draft (pack opening), Deckbuilder
    table/           3D scene, textures, drag & drop, HUD, dialogs
    debug/           debug console
    theme.ts         UI themes: which one is active and remembered, ?theme= previews, Alt+Shift+T
    themes/          theme overrides (Game Night, Signal) on top of styles.css + screens.css (Arcane)
```

- **The server is authoritative.** Each player only ever receives their own view: other packs, other
  hands, libraries and face-down cards are stripped server-side (`tableViewFor`, `Room.viewFor`).
- **Card data** is fetched once per lobby from Scryfall (and CubeCobra for cube links) and stored in the
  room's Durable Object. The **bundled Hypercube** (`public/presets/hypercube.json`, ~80 KB gzipped) skips
  those lookups: one click, loaded as a static file by the browser (solo) or through the Worker's `ASSETS`
  binding (online rooms). Refresh it, or add presets to `src/shared/presets.ts`, with
  `npm run presets:build`. **Images** are loaded lazily by each browser straight from Scryfall's CDN; until
  an image arrives, cards are drawn from their text (name, cost, type, rules, P/T).
- **Reconnects:** your seat is remembered in `localStorage` per room, so refreshing or closing the tab
  rejoins the same seat. From another device or browser, a started game offers the seats nobody is using
  ("I'm Alice"); picking one issues a new seat secret (trust-based, it's a game among friends).
- **Your rooms** on Home lists the rooms to go back to, tagged **Hosted** or **Joined**: the invite's
  rooms (from its ledger, so on any device) plus the last 8 rooms this browser joined (and 8 it hosted), kept in
  `localStorage` next to the seat secrets. The browser's entries are a snapshot from the last visit (no
  server calls); public rooms drop off at their closing time, others after 30 days unseen or when a join
  finds the room gone. Only an invite's own rooms can be deleted; × on the rest just hides them.
- **Solo mode** swaps the websocket for `local.ts`, which runs `Room` in the tab: `setTimeout` stands in
  for alarms and nothing is persisted. Screens can't tell the difference.
- **Invites own rooms.** Each invite code has a small Durable Object ledger: at most 10 new rooms per
  rolling 24h and 25 saved rooms (delete one from **Your rooms** to make space). Rooms push a short summary
  (players, phase, cube) to it when that changes, so listing rooms wakes one object, not 25. Rooms idle
  for 90 days are deleted lazily the next time the ledger is used; there are no expiry timers.
- **Public rooms close on their own** (when enabled): at most 3 exist at once, each lasts up to 3 hours
  (closing sooner once nobody has been connected for 15 minutes), and all of them together get 12
  room-hours per UTC day. See [Public rooms](#public-rooms-optional).
- **Flood control** (`src/shared/rateLimit.ts`). Every room, invite or public, limits:
  - each socket to bursts of 60 messages, 30/s for a few minutes and 5/s over the long run;
  - the whole room to 10 messages/s, and to bursts of 120 state changes at 1/s sustained. State changes
    are what cost storage writes, the scarcest free-plan quota.

  Extra messages are dropped with a "slow down" notice. A socket that keeps going over its own limits is
  closed, and that player can't rejoin for a minute. Dropped messages still wake the room and count as
  requests, so dropping alone isn't enough. A dragged group of cards is one message, however many cards.
- **Nothing wakes a room by accident.** Room codes carry HMAC check characters, so the Worker rejects
  made-up codes without touching a Durable Object; the draft clock pauses (no alarms) while no humans are
  connected, so an abandoned draft waits for you; alarms are only rewritten when the deadline changes, and
  an overdue deadline that doesn't advance backs off instead of re-firing in a loop.

## UI themes

The screens and the table HUD (not the 3D table itself) come in three themes. **Game Night** (walnut,
brass and oxblood) is the default, **Signal** is graphite with a lime accent, and **Arcane** is the
original violet-and-gold look. Players pick one at the bottom of the home page, from the debug console, or
cycle with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>; the choice is remembered per browser. Visitors who never
choose follow the default. `?theme=gamenight|signal|arcane` previews a theme for one visit without changing
the saved choice.

`styles.css` + `screens.css` are the base and the Arcane look. Each other theme is one file in
`src/client/themes/`, scoped to `<html data-theme="…">`, that redefines the tokens in `:root` (colours,
fonts, radius, and the optional surface tokens listed there) and restyles components where needed. To add
one, create `themes/<id>.css`, import it in `main.tsx`, add it to `THEMES` in `theme.ts` and to the pre-paint
list in `index.html` (`tests/theme.test.ts` checks these agree), and add its fonts to `index.html` (browsers
only download the font files a page actually uses).

## Controls (tabletop)

Press <kbd>?</kbd> on the table for the full list. Highlights: drag cards anywhere (onto piles, back to
hand), click a hand card to select it and again to zoom in (← → browses your hand; playing is always a
drag or a menu pick), double-click to tap / draw, right-click for menus (counters, face down, scry, search, mill,
mulligan…), <kbd>T</kbd>/<kbd>Space</kbd> tap, <kbd>F</kbd> face down, <kbd>G</kbd>/<kbd>X</kbd>/<kbd>H</kbd>
graveyard/exile/hand, <kbd>D</kbd> draw, <kbd>U</kbd> untap all, <kbd>N</kbd> end turn, arrows/<kbd>Q</kbd>
<kbd>E</kbd>/wheel for the camera, <kbd>1</kbd>–<kbd>4</kbd> view from any player's seat (1 is yours),
<kbd>V</kbd> overhead view, <kbd>Tab</kbd> ping the spot under the pointer (everyone sees and hears it, like
Tabletop Simulator). Card names in the game log are links: hover for a preview, click to zoom in.

**Double-faced cards** show both faces in hover previews and have a ⟲ button to turn them over everywhere
(draft, picks, deckbuilder, zoom view — <kbd>F</kbd> there — and your hand, where <kbd>R</kbd> works too). A card
turned over in your hand enters the battlefield on that face.

**Rules help:** the zoom view lists the card's mechanics (Scryfall's keywords: Flying, Scry, Landfall…)
and rules-relevant types. Hovering one (tapping, on touch screens) explains it in place with the reminder
text and opening summary from the community [MTG Wiki](https://mtg.wiki), fetched on first use and cached;
clicking opens the full wiki page in a new tab. A
**View detailed rulings** button fetches the card's official rulings from Scryfall, only when clicked, and
keeps them for the session. Hidden cards show none of this. The ⌃ button hides the panel (remembered in
`localStorage`); a book button next to the card name brings it back.

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
   The first deploy creates the `hyperdraft` Worker and applies the Durable Object migrations (`v1`
   `RoomDurableObject`, `v2` `InviteDurableObject`). Wrangler prints the URL, e.g.
   `https://hyperdraft.<your-subdomain>.workers.dev`. If this is your account's first Worker, Cloudflare
   asks you to pick a `workers.dev` subdomain.
3. **Set the production secrets** (they survive redeploys; online hosting needs both):
   ```bash
   ROOM_CODE_SECRET=$(openssl rand -base64 32)
   printf '%s\n' "$ROOM_CODE_SECRET"  # copy this value to your password manager
   printf '%s' "$ROOM_CODE_SECRET" | npx wrangler secret put ROOM_CODE_SECRET
   unset ROOM_CODE_SECRET

   npm run invite:new -- sam          # prints a fresh invite entry and magic link
   npx wrangler secret put INVITE_CODES   # paste entries, comma-separated: sam:<key>,jo:<key>
   ```
   Save `ROOM_CODE_SECRET`: Cloudflare won't show secret values again, and changing this one invalidates
   all existing room codes. In `invite:new -- sam`, `sam` is just a label to identify the invite; friends
   use the generated key, not the label. Add the printed `sam:<key>` entry to `INVITE_CODES`.
4. **Share** the site URL with anyone (solo mode needs nothing), and a magic link
   `<site URL>/?invite=<key>` with each friend who should be able to host. Room and invite links are
   built from whatever host serves the app, so any hostname you attach to the Worker works too.

**Managing invites:** `INVITE_CODES` is the whole admin panel. Add an entry to invite someone; remove it
to revoke (their existing room links keep working for players); change the key but keep the label to
rotate it. Cloudflare won't reveal a lost invite key: generate a replacement and update the full
`INVITE_CODES` value, keeping any other entries you still use. The label is the invite's identity:
renaming it starts a fresh, empty "My rooms".

**Kill switch:** `echo false | npx wrangler secret put ONLINE_ENABLED` turns online rooms off instantly
(solo mode keeps working); `npx wrangler secret delete ONLINE_ENABLED` turns them back on.

### Public rooms (optional)

Public rooms let anyone host a game without an invite code, from a small shared pool. **They're off unless
you turn them on:**

```bash
echo true | npx wrangler secret put PUBLIC_ROOMS_ENABLED      # turn on
npx wrangler secret delete PUBLIC_ROOMS_ENABLED               # turn off again
```

How they work:

- **3 public rooms at once**, shared by everyone. A slot frees up as soon as its room closes.
- **Each room lasts up to 3 hours**, and closes sooner **once nobody has been connected for 15
  minutes**. Its link stops working and nothing in it is kept. Everyone in the room sees a countdown and
  gets warnings 30, 10 and 1 minute before it closes.
- **12 room-hours per UTC day** for all public rooms together. Each new room books its whole lifetime up
  front (3 hours, or whatever is left of today's budget, shortening the last rooms of the day) and gets
  back the time it didn't use when it closes early. Whatever happens in the rooms, public rooms can't run
  for more than 12 hours a day in total. That's all three tables used from start to finish, plus one more
  full room, before any time comes back from rooms that closed early.
- **One public room per visitor at a time, and 2 per UTC day.** Visitors are told apart by IP address (a
  whole /64 for IPv6). The pool only stores a keyed hash of it, never the address itself.
- **An invite code takes precedence.** A browser with a valid invite hosts invite rooms as before, which
  never use public slots. Solo mode is unaffected, and `ONLINE_ENABLED=false` turns public rooms off too.
- Tune the limits in `src/shared/publicRooms.ts` (`PUBLIC_LIMITS`). The hosting status shown on the home
  page is cached by the Worker for 15 seconds, so visitors loading the page don't each wake the pool.

**Optional: Turnstile bot check.** [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) is a
free CAPTCHA alternative that most visitors never see. With it, a script can't grab every public slot the
moment one frees up. The check is asked for **only when both keys are set**:

1. In the Cloudflare dashboard, go to **Turnstile → Add widget**. Add your site's hostname (e.g.
   `hyperdraft.<your-subdomain>.workers.dev`, plus any custom domain) and pick **Managed** mode.
2. Store the two keys it gives you:
   ```bash
   npx wrangler secret put TURNSTILE_SITE_KEY      # public "site key", sent to browsers
   npx wrangler secret put TURNSTILE_SECRET_KEY    # "secret key", stays on the server
   ```
   Delete either one to turn the check off. Failed checks are rejected by the Worker before any Durable
   Object is involved, so they don't use Durable Object quota. Tokens must come from your site and from the
   public-room widget (Cloudflare's `hostname` and `action` checks). Cloudflare's test keys skip those two
   checks. Without Turnstile, a script can still send create requests, and each one wakes the pool, so
   set it up if public rooms see much traffic.

**Free-plan costs.** When any Durable Object free-tier daily limit is exceeded, Durable Object calls fail for
the whole account until the daily reset, so invite rooms would stop working too. The daily budget and flood
control keep public rooms well inside the limits, even if every public room is flooded around the clock:

| Free daily limit | Public rooms at most | Why |
|---|---|---|
| Duration, 13,000 GB-s | about 5,400 GB-s | 12 room-hours × 450 GB-s per room kept awake for an hour |
| Storage writes, 100k rows | about 44,000 | 12 room-hours × 1 state change/s, plus bursts |
| Requests, 100k | about 22,000 for messages handled | 12 room-hours × 10 messages/s ÷ 20 (WebSocket messages bill 20:1) |

Real games use far less, since rooms hibernate between moves. Messages dropped just before a flooding socket
is closed, reconnects and page loads add some requests on top. That leaves more than half of each limit for
invite rooms. If public rooms get heavy use, the Workers Paid plan ($5/month) turns these hard limits into
small overage charges. Turn public rooms off at any time with the commands above.

**Optional: a rate-limiting rule.** If you serve the Worker from a zone on your Cloudflare account, add a
WAF rate-limiting rule there, e.g. requests to URI path starting with `/api/` above 60 per 10 seconds per
IP → Block. Blocked requests never reach the Worker, so floods can't use up your daily free-plan
requests. (`workers.dev` hosts can't have WAF rules.)

Useful afterwards:

- `npx wrangler tail` — live logs from the deployed Worker (room errors, imports).
- Renaming the Worker: change `name` in `wrangler.jsonc`.
- If you ever rename/remove the Durable Object class, add a new migration entry — don't edit `v1`.

## Credits & legal

Card data and images courtesy of [Scryfall](https://scryfall.com) (please respect their
[API guidelines](https://scryfall.com/docs/api)); cubes from [CubeCobra](https://cubecobra.com); mana
symbols from the MIT-licensed [Mana font](https://github.com/andrewgioia/mana); rules help shows short
excerpts from the [MTG Wiki](https://mtg.wiki) (CC BY-NC-SA 4.0, credited and linked in place) and never
copies the Comprehensive Rules. HyperDraft is unofficial Fan
Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed by Wizards.
Keep it free — don't paywall or monetize anything built on this data.

## Roadmap

- **Checkpoint 1 (done):** lobby + share codes, cube import & validation, full draft with bots/timers/
  burns, deckbuilder, freeform 3D table (zones, tap, flip, transform, counters, tokens, life, scry/search,
  mulligan, dice, log), debug console.
- **Checkpoint 2:** fully 3D pack opening with a holo shader and particles, Scryfall token art, table
  polish (box-select, card stacks/attachments, hand reordering, opponent-hand reveal, sounds on the table).
- **Checkpoint 3:** real-set drafting (rarity slots, Play Booster / classic presets), spectators, text
  chat.
