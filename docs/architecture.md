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
  binding (online rooms). It's generated from CubeCobra and Scryfall when the site is built or deployed
  (gitignored, so the current tree doesn't hold the card data; earlier commits do). Refresh it, or add presets to `src/shared/presets.ts`, with
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
  next join or message settles presence at once; public rooms keep checking so their slot is never held by a
  dead socket); alarms are only rewritten when the deadline changes, and
  an overdue deadline that doesn't advance backs off instead of re-firing in a loop. Backstops for when that
  logic has a bug are in [Alarm backstops](#alarm-backstops).

## Alarm backstops

A room's alarm is its "wake me up at" timer: the next pick deadline, the next check for dead sockets, or a
public room's closing time. It's the one cost that needs no player. Every wake-up is a billed request and a
storage write or two, and if a bug made the room keep asking to be woken "now", it would wake every 50 ms
(the existing floor) for as long as the bug lasted: about 1.7 million times a day per room, with nobody
online. That is how the well-known Durable Object bills of tens of thousands of dollars happened. On the
free plan it would use up the day's allowance and take online rooms down until midnight UTC; on Paid it
costs money, and Cloudflare's billing alerts arrive a day late and never pause anything.

Three backstops, all in `src/worker/roomObject.ts`:

1. **Wake-ups at least 2 s apart** (`MIN_ALARM_GAP_MS`). `scheduleAlarm` never sets the alarm sooner than
   2 s after the last wake-up. A looping room then costs about 43,000 wake-ups a day instead of 1.7 million.
2. **The kill switch reaches alarms.** `ONLINE_ENABLED=false` is checked by the Worker, but alarms survive
   the redeploy that setting it causes and go straight to the room. So `alarm()` and `webSocketMessage()`
   check it too (`closeIfOffline`), and `scheduleAlarm` drops pick timers and presence checks while it's off,
   whoever calls it (a late close event, the constructor). A public room keeps only its closing-time alarm,
   so it still closes and frees its slot. The room's state is kept for when online rooms come back.
3. **Only `scheduleAlarm` sets the alarm.** `tests/tooling/alarmCalls.test.ts` parses `src/` and fails CI on a
   direct `setAlarm`/`deleteAlarm` call anywhere else (`destroy` may delete it). It reads names, not types,
   so `storage["setAlarm"]` would slip past; don't write that.

Each has a test in `tests/worker/roomObject.test.ts` that fails without it.

### Decision: a minimum gap, not a per-minute cap (2026-10-27)

The first version allowed 30 wake-ups per rolling minute. Independent review found two problems: the
fastest allowed pick timer (1 s, fixed) wakes an idle table about once a second, so the cap would stall
auto-picks for up to a minute; and the list of recent wake-ups lived in memory, so an object evicted
between bursts started from zero. We compared:

| Option | Breaks an allowed setting? | Worst delay to honest play | Ceiling per looping room | Safe across eviction? |
|---|---|---|---|---|
| 30 per minute (first version) | yes, timers under ~2 s | ~60 s | 43k wakes/day | no, needs storage writes |
| 120 per minute | no | ~60 s | 173k/day | no |
| Cap derived from each room's timer | no | ~60 s | 43k/day normally | no, and more code to get wrong |
| Raise the minimum pick timer | changes the game | ~60 s | 43k/day | no |
| **At least 2 s between wake-ups** | **no** | **2 s** | **43k/day** | **yes, with no writes** |
| At least 1 s between wake-ups | no | 1 s | 86k/day | yes |

We chose **2 s**:

- **Same ceiling as before**, so the cost figures in [Deployment](deployment.md) hold: about 43,000 wake-ups a
  day per looping room, roughly $3–5 a month on Paid instead of hundreds.
- **Honest play doesn't notice.** One wake-up auto-picks every overdue seat (`advance` in `draft.ts`), so
  deadlines that come due close together merge. On a 1 s fixed timer, auto-picks for idle players land at
  most 2 s late; normal timers (30 s and up) fire exactly on time. Both are tested.
- **Memory is enough.** The last wake-up time is kept in memory, and Cloudflare only evicts an idle object
  after about 10 s, longer than the gap, so a fresh object starting from zero can't wake faster than allowed.
  The per-minute version would have needed a storage write to survive eviction.
- **Simpler**: one timestamp instead of a list, and one number for other games to adapt.
- **2 s rather than 1 s** keeps the ceiling unchanged. 1 s would keep a 1 s timer exact at twice the ceiling,
  which isn't worth it for a setting nobody drafts with.

No cap here protects the free plan's daily allowance: even at one wake every 2 s, a looping room writes
most of the 100,000 rows a day. The kill switch is the tool for that; the gap is what keeps a bug on Paid
from becoming a large bill. Revisit if a feature needs alarms more often than every 2 s (lower the gap and
update the ceiling here and in Deployment), or if Cloudflare changes how soon idle objects are evicted.

