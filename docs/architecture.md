# Architecture

HyperDraft is one TypeScript codebase in three parts: a pure shared core, a Cloudflare Worker with
Durable Objects, and a React + React Three Fiber client. Solo mode runs the same room engine in the
browser tab, so screens can't tell the difference between solo and online play.

## Code map

```
src/
  shared/        Pure TypeScript, no DOM/Workers APIs — unit tested
    types.ts         data model (cards, lobby config, draft, decks, table)
    importParser.ts  CubeCobra URL / "set:WTH" / plain list / "4 Name" / Arena "(SET) 123" / CubeCobra CSV
    cardSources.ts   Scryfall /cards/collection (75 per request) + fuzzy fallback, CubeCobra cubeJSON
    setSource.ts     whole-set import: one plain booster printing per card (no alt art, promos, basics)
    draft.ts         booster draft engine: packs (random or by rarity slots), passing L/R/L, burns, pick timers, bots
    autopick.ts      card scoring (CubeCobra ELO + rarity + colour commitment)
    deck.ts          auto-lands (by mana symbols), auto-build
    table.ts         tabletop actions + per-player views that hide hands/libraries/face-down cards
    room.ts          whole room state machine: lobby → drafting → deckbuilding → playing
    protocol.ts      zod-validated client messages, server messages, per-player RoomView
    importCube.ts    import pipeline (preset/CubeCobra/set/list → Scryfall), shared by the DO and solo mode
    presets.ts       cubes bundled as static snapshots (public/presets/*.json)
    roomCode.ts      signed room codes (HMAC check characters)
    invites.ts       invite codes, quotas, "My rooms" ledger, idle expiry
    publicRooms.ts   public room pool: slots, per-visitor rule, IPv6 /64 grouping
    rateLimit.ts     token buckets for flood control in rooms
    presence.ts      when a room wakes to check for dead sockets, and when it goes quiet and sleeps
    roster.ts        the avatars and table companions (names, backstories, colours, ids)
    scene.ts         the tables and environments players can pick (ids, labels, defaults)
    treats.ts        the Treatomancer: treats, glimmers, companion lines, the race planner
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
    screens/         Home (+ Your rooms), Solo, Lobby, Draft (pack opening), Deckbuilder, Sound Studio, Companion Lab, Scene Lab
    pack/            the 3D foil booster on the Draft screen: pillowed/crimped geometry, tear-and-peel
                     math (pure, unit tested), canvas-drawn per-theme foil art, the R3F scene
    sfx.ts           sound effects: generated samples (public/sfx/<pack>/) on one compressed bus, synth fallback
    soundPacks.ts    which sound pack plays (switchable, remembered, ?sounds= previews)
    soundStudio.ts   the Sound Studio's sequences and per-sound mix (/dev/sound-studio)
    table/           3D scene, textures, drag & drop, HUD, dialogs, companion motion (companionMotion.ts)
    scene/           the 3D tables, the environments around them and the title screen's backdrop
    volume.ts        master and sound-effects volume (music keeps its own in music.ts)
    music.ts         background music: one playlist (public/music/) that plays across every screen
    components/SettingsDialog.tsx   player settings modal (tabs: Appearance, Sound, Companions)
    components/MusicPlayer.tsx      the music player: corner pill, expands to a bar along the bottom
    debug/           debug console (bug icon, bottom right; only after a visit with ?debug)
    debugAccess.ts   whether this browser shows the debug console (?debug turns it on, ?debug=0 off)
    theme.ts         UI themes: which one is active and remembered, ?theme= previews, Alt+Shift+T
    themes/          theme overrides (Game Night, Signal) on top of styles.css + screens.css (Arcane)
```

## How it fits together

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
  for alarms and nothing is persisted.
- **Invites own rooms.** Each invite code has a small Durable Object ledger: at most 10 new rooms per
  rolling 24h and 25 saved rooms (delete one from **Your rooms** to make space). Rooms push a short summary
  (players, phase, cube) to it when that changes, so listing rooms wakes one object, not 25. Rooms idle
  for 90 days are deleted lazily the next time the ledger is used; there are no expiry timers.
- **Public rooms close on their own** (when enabled): at most 3 exist at once, each lasts up to 3 hours
  (closing sooner once nobody has been connected for 15 minutes), and all of them together get 12
  room-hours of new rooms per UTC day (rooms opened late can run past midnight). See [Public rooms](deployment.md#public-rooms-optional).
- **Flood control** (`src/shared/rateLimit.ts`). Every room, invite or public, limits:
  - each socket to bursts of 60 messages, 30/s for a few minutes and 5/s over the long run;
  - the whole room to 10 messages/s, and to bursts of 120 state changes at 1/s sustained. State changes
    are what cost storage writes, the scarcest free-plan quota.

  Extra messages are dropped with a "slow down" notice. A socket that keeps going over its own limits is
  closed, and that player can't rejoin for a minute. Dropped messages still wake the room and count as
  requests, so dropping alone isn't enough. A dragged group of cards is one message, however many cards.
- **Nothing wakes a room by accident.** Room codes carry HMAC check characters, so the Worker rejects
  made-up codes without touching a Durable Object; the draft clock pauses (no alarms) while no humans are
  connected, so an abandoned draft waits for you; the check for dead sockets runs once a minute only while
  someone has joined or acted in the last 10 minutes (a tab left open overnight lets the room sleep, and the
  next join or message settles presence at once); alarms are only rewritten when the deadline changes, and
  an overdue deadline that doesn't advance backs off instead of re-firing in a loop.
