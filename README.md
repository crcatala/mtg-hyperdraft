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
Hypercube and readies you up). The debug console is hidden from players: open the app once with `?debug`
(e.g. `http://localhost:3000/?debug`) and this browser remembers it; `?debug=0` or its **Turn off** button
hides it again. Then press <kbd>`</kbd> (backtick) or the bug icon for the console: **Skip to table** jumps
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

## Avatars and companions

Players can give themselves an **avatar** (a character portrait) and a **companion** (a little creature
that stands in front of their mat). Both are optional: a human starts with neither, shows up as a hooded
stranger, and can pick in the lobby (**Avatar…**, **Companion…** or **Surprise me** on the Players panel).
Bots are dealt a random pair. A choice is remembered in the browser for the next room. The player's name
stays their main identity everywhere; hovering anyone's face (lobby, draft ring, deckbuilder, table HUD)
reveals the character behind it.

- The cast lives in `src/shared/roster.ts`, and the art in `public/roster/{avatars,companions}/`
  (`<id>.webp` plus a face crop or small icon; `mystery*.webp` is the hooded default). Ids are stored on
  each `Player`, so never rename or reuse one. Rooms saved before this existed load fine.
- Several players may pick the same avatar or companion. Whoever holds it second (or third...) gets a
  different colour variant, stored as `avatarVariant` / `companionVariant`: a turned hue for the ring and
  portrait background, and for the companion's picture. The first holder keeps the original.
- `setLook` (lobby only) sets or clears either choice; the room engine in `shared/room.ts` does all the
  bookkeeping, so solo mode behaves the same.
- A companion is one flat picture (`table/CompanionFigure.tsx`) brought to life by procedural motion: 18
  reactions (hello, the 7-step poke ladder, sulk, pickup, carry, drop, 6 emotes) built from shared motion
  primitives and effect glyphs (`table/companionMotion.ts`, pure and tested), a body style per companion and
  signature moves drawn from its `moves` (`table/companionReactions.ts`). `playReaction(playerId, slot)`
  (`table/companionPlayback.ts`) plays one on anyone's companion. **Companion Lab** (`/dev/companion-lab`,
  linked from the debug console) plays every reaction of every companion, slowed down or four at once.
- **Poking**: anyone can tap any companion at the table. Each tap climbs a 7-step ladder of reactions and
  speech-bubble lines, ending in a cheeky finale and a sulk (`table/pokeLadder.ts`); the room relays pokes to
  the other players like pings and stores nothing (`table/companionPoke.ts`). Bubbles and table voices go
  through `say`/`voice` in `table/companionTalk.ts`.
- **Emotes**: right-click your own companion for a wheel of six emotes (cheer, love, oops, silly, sass, taunt:
  same order for everyone; pick with a click, a right-drag-and-release, or the keys 1-6 / arrows + Enter). Your
  companion plays that emote's voice and reaction and says its line in a large bubble, for everyone; the room
  relays it like a poke and stores nothing (`table/companionEmote.ts`, wheel in `table/EmoteWheel.tsx`). One
  emote per 1.5 s per player. **Edit lines** under the wheel (or <kbd>E</kbd>) rewrites any of your six lines,
  text only, in this tab's memory: a reload brings the defaults back (`table/emoteLines.ts`,
  `table/EmoteLinesDialog.tsx`). A rewritten line travels with the emote; client and room both clean it with
  `shared/emoteText.ts` (one line, no invisible or bidi characters, 60 characters at most), and React shows it
  as plain text. There's no content filter, by design. <kbd>W</kbd> opens the wheel from the keyboard; the gear
  under it (<kbd>S</kbd>) goes to Settings → Companions.
- **Pick up and drop**: press and hold your own companion to pick it up, carry it, and let go anywhere on the
  table except another player's mat (your own mat is fine); a bad spot sends it back. Others see it carried live
  (relayed, not stored); where it lands is the one thing stored (`Player.companionAt`, one write per drop, checked
  by the room with the same `petSpotValid` in `shared/tableLayout.ts`). **Home** in the wheel's centre (<kbd>H</kbd>)
  sends it back by your mat (`table/companionCarry.ts`, `table/petGesture.ts`).
- **Settings → Companions** has two switches, remembered per browser (`companionPrefs.ts`, `hd.companions`):
  **Companion sounds** (off: no voices, at the table or the lobby hello, and none downloaded; companions still
  react) and **Companion speech** (off: no bubbles, emotes included; sounds and reactions stay). They only change
  what this player sees and hears, never what is sent. The gates are `say`/`voice` in `table/companionTalk.ts` and
  `sayHello` in `companionVoice.ts`; the lab and sound studio always play voices.
- **Accessibility**: the wheel is a labelled menu (each wedge's name is its tone and line) that works from the
  keyboard alone (<kbd>W</kbd>, <kbd>1</kbd>-<kbd>6</kbd> or arrows/Tab + <kbd>Enter</kbd>, <kbd>Esc</kbd>), and
  focus goes back where it was when it closes. Emotes are read out politely by screen readers through a visually
  hidden live region ("Alice's Hex: Ten lives. You have one."); pokes and pick-ups are not. Reduced motion: the
  companions, glyphs, bubbles, wheel and lobby preview hold still (fades only).
- `tests/companionAudit.test.ts` checks what shipped against the plan: 10 companions × (16 voice slots, 15 lines,
  18 reactions) = 160 / 150 / 180. Run it with `--reporter=verbose` to see the per-companion counts.
- To add a character, add an entry to `roster.ts` and its images; `tests/roster.test.ts` checks that
  every entry has its files. The prompts and style notes used to generate the current art are in
  `scripts/roster/roster.json`.

## The Treatomancer (companion treats)

A wizard's gumball machine sits on the table beside each player's mat. **Click it (or press <kbd>B</kbd>)** for its menu:
ten treats, from a Cursed Left Sock (1 glimmer) to The Golden Pickle (6). Everyone gets a pouch of **12 glimmers** per
game. Pick one and **Feed it & launch!**: the machine rattles and winds up, fires a capsule in a high arc onto a random
open spot in the middle of the table (never on a mat), and it pops open. Every companion at the table races for it at
its own random speed (the odd one gets the zoomies, some dawdle, some trip and say so). The first one there eats it, or
hugs it if it's a keepsake, and says one of its own three lines about it; the rest pout, grumble, and everyone trots home.

- **One player at a time.** Opening the menu takes hold of the machine (for up to 60 s); everyone else sees "Alice is
  browsing treats…" with her face over their machine, and a click on theirs is turned away. Closing the menu, buying,
  the hold running out or Alice dropping out lets go.
- **Hands off during the show.** From the purchase until everyone's home, nobody can poke, carry or emote with a
  companion, or use the machine. The room enforces it too.
- **The same race on every screen.** The room picks a seed and a landing spot and sends them with the racers' start
  spots (`treat`); `planShow` in `shared/treats.ts` works out every speed, trip and the winner from that alone, so
  nothing about the race itself goes over the wire. The glimmers left are stored per player on the table
  (`TablePlayer.glimmers`, one write per purchase, logged). The show's end time is saved in that same write
  (`RoomState.treatShowUntil`), so a room rebuilt mid-show (hibernation, a deploy) stays locked; the browsing hold is
  in memory only (a purchase doesn't need one).
- Each player has their own copy of the machine (`machineSpot`): the cameras frame each mat too tightly for one shared
  machine to be in everyone's shot. Only where the capsule flies *from* differs between screens; landings keep clear of
  every seat's machine.
- Code: `shared/treats.ts` (catalog, lines, the race planner, where it stands and lands), `table/treatShow.ts` (the
  beats: sounds, reactions, voices, bubbles), `table/treatState.ts`, `table/Treatomancer.tsx` (the procedural machine),
  `table/TreatFlight.tsx` (capsule and treat), `table/TreatMenu.tsx` + `treats.css` (menu and tags). The race reactions
  (`alert`, `dash`, `trip`, `feast`, `hug`, `pout`) are in `TREAT_REACTIONS` in `table/companionReactions.ts`; companions
  reuse their existing voices (cheer to win, oops to trip, bothered to lose).
- Art: `public/treats/<id>.webp` (generated with GPT Image, transparent). Sounds: `public/treats/sfx/` from the prompts
  in `scripts/sfx/treats.json` (`node scripts/build-treat-sfx.mjs [names…]`, needs `ELEVENLABS_API_KEY`).
- Solo games only have your own companion at the table (bots don't sit down), so it races alone.

## UI themes

The screens and the table HUD (not the 3D table itself) come in three themes. **Game Night** (walnut,
brass and oxblood) is the default, **Signal** is graphite with a lime accent, and **Arcane** is the
original violet-and-gold look. Players pick one in Settings (the gear in the top bar, or beside Help on the table), at the bottom of the home page, or
cycle with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>; the choice is remembered per browser. Visitors who never
choose follow the default. `?theme=gamenight|signal|arcane` previews a theme for one visit without changing
the saved choice.

`styles.css` + `screens.css` are the base and the Arcane look. Each other theme is one file in
`src/client/themes/`, scoped to `<html data-theme="…">`, that redefines the tokens in `:root` (colours,
fonts, radius, and the optional surface tokens listed there) and restyles components where needed. To add
one, create `themes/<id>.css`, import it in `main.tsx`, add it to `THEMES` in `theme.ts` and to the pre-paint
list in `index.html` (`tests/theme.test.ts` checks these agree), and add its fonts to `index.html` (browsers
only download the font files a page actually uses).

## Tables and environments

The 3D table comes in three designs and stands in one of three environments, picked from the **Scene** button on
the table's toolbar (next to Help). The choice is shared: anyone at the table can change it, everyone sees the
change at once, and the game log says who did it. It's stored by the room (`RoomState.scene`, one write per change),
so it survives reloads and carries over to the next game in that room. It's purely cosmetic: every table is drawn
around the same round play area (`tableRadius` in `shared/tableLayout.ts`), so switching never moves a card, a mat,
a pile or a companion. That play area clears the outer corners of every mat by a margin at any seat count, and a
companion can be put down anywhere on it.

| Tables | Environments |
|---|---|
| **Classic felt**: round walnut table, green baize, padded leather rail | **Tavern hearth**: fireplace, bar, barrels, mana-coloured shields, a sleeping cat |
| **Runestone**: twelve-sided slate slab ringed with glowing runes, floating crystals | **Arcane library**: bookcases, moonlit windows, a turning summoning circle, floating candles and books, an orrery |
| **Oak & brass**: square oak card table with a leather inlay and a candle in each corner | **Moonlit grove**: standing stones, swaying pines, fireflies, glowing mushrooms, an owl |

Each table has its own chairs, one per seat. Environments keep the lighting on the table about the same (cards read
the same everywhere); only its colour shifts with the mood. When the table opens, the camera starts wide on the room
and glides down to your seat (any camera input, or reduced motion, skips it); after that the room is mostly seen
round the table's edges, when zooming out or in the overhead view.

The **title screen** shows a table set for a game in one of the environments, with the camera slowly circling it:
each UI theme has its own pairing (`scene/titleScenes.ts`: Game Night is the oak table by the tavern hearth, Arcane
the runestone in the library, Signal the felt table in the grove) behind a scrim that keeps the menus readable
(`--home-scrim`, per theme). Without WebGL Home keeps its plain background.

- Everything is built in code: low-poly geometry and canvas-drawn textures (`scene/sceneTextures.ts`, drawn once
  from a fixed seed and cached), no model or image files. Small things move (flames, fireflies, the cat's breathing,
  the orrery, the owl, swaying trees); with reduced motion everything holds still.
- They're kept cheap: repeated things are instanced (chairs, trees, books, mushrooms), every candle in a scene is
  drawn in three draw calls (`CandleBatch` in `scene/bits.tsx`), the floor's light falloff is baked into vertex
  colours, and the table and title canvases drop to 1x pixel density if the frame rate can't keep up.
- **Scene Lab** (`/dev/scene-lab`, linked from the debug console) shows any table in any environment at 1-4 seats
  with stand-in mats: from your seat, zoomed out, overhead, orbiting, or with the title camera, plus draw calls and
  frame rate. `?table=&env=&seats=&cam=` preset it; `?hide=sprites,points,transparent,env,lights` hides kinds of
  objects to see what costs what.
- To add one: an entry in `TABLE_STYLES` or `ENVIRONMENTS` (`shared/scene.ts`), a component in `scene/tables.tsx` or
  a new `scene/<id>.tsx` wired into `scene/Environment.tsx` (with its mood: background, fog and light colours), and
  a swatch in `screens.css` (`.scene-swatch.s-<id>`). A table must draw its play surface as exactly the
  `tableRadius` disc and pass it the `surface` handlers. Ids are stored in rooms, so never rename or reuse one;
  unknown ids fall back to the default.

## Controls (tabletop)

Press <kbd>?</kbd> on the table for the full list. Highlights: drag cards anywhere (onto piles, back to
hand), click a hand card to select it and again to zoom in (← → browses your hand; playing is always a
drag or a menu pick), double-click to tap / draw, right-click for menus (counters, face down, scry, search, mill,
mulligan…), <kbd>T</kbd>/<kbd>Space</kbd> tap, <kbd>F</kbd> face down, <kbd>G</kbd>/<kbd>X</kbd>/<kbd>H</kbd>
graveyard/exile/hand, <kbd>D</kbd> draw, <kbd>U</kbd> untap all, <kbd>N</kbd> end turn, arrows/<kbd>Q</kbd>
<kbd>E</kbd>/wheel for the camera, <kbd>1</kbd>–<kbd>4</kbd> view from any player's seat (1 is yours),
<kbd>V</kbd> overhead view, <kbd>Tab</kbd> ping the spot under the pointer (everyone sees and hears it, like
Tabletop Simulator), **Scene** (toolbar) for the table and environment, for everyone. Card names in the game log are links: hover for a preview, click to zoom in.

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

Background music (`public/music/`) was generated with [Suno](https://suno.com) (the files carry Suno's C2PA
provenance metadata). Suno's terms for generated tracks depend on the plan they were made under, so check the
current terms before using them commercially or redistributing them outside this free project.

## Pack opening and sound

On the Draft screen a fresh pack is a real 3D foil booster (`src/client/pack/`). It drops in, catches
the light as the pointer moves, and is **torn open by dragging across the top** (or click it / press
<kbd>Space</kbd>): the strip peels away behind the tear front, light leaks out, and on the last inch the
strip flies off and the cards slide out to be dealt. Packs are themed (Game Night, Signal, Arcane each
have their own foil). If WebGL isn't available or the 3D pack fails to start, the simple CSS pack is used
instead; add `?pack=css` to the URL to force it. Reduced-motion skips the opening entirely.

Sound effects come in switchable **sound packs**, like the UI themes: **Tabletop** (the default: wood,
cardstock and soft chimes), **Arcane** (crystal chimes, harp), **Library** (parchment, leather, a music box)
and **Grove** (leaves, twigs, kalimba). Pick one in Settings (it plays a short sample); the choice is remembered, and
`?sounds=<pack>` previews one for a visit. Each pack is a folder of short samples in `public/sfx/<pack>/`,
generated with the [ElevenLabs sound-effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
(the files are committed, so you only need this to change or add one):

```bash
npm i -g @elevenlabs/cli && export ELEVENLABS_API_KEY=...
node scripts/build-sfx.mjs                      # generate whatever is missing, in every pack
node scripts/build-sfx.mjs tabletop tear flip   # regenerate these sounds in one pack
node scripts/build-sfx.mjs --force              # regenerate everything
```

- `src/client/sfxManifest.json` lists the sounds (name, takes, length); the client, the generator and a test share it.
- `scripts/sfx/prompts/<pack>.json` says what each sound is in that pack. **A new pack** is a prompts file, an entry
  in `src/client/soundPacks.ts`, and `node scripts/build-sfx.mjs <pack>`; a test fails until every sound exists.
- **Sound Studio** (`/dev/sound-studio`, linked from the debug console) auditions the packs: it plays the draft's
  sound sequences (opening a pack, making a pick, browsing cards) with the game's own timings, plays any sound
  from any pack, and lets each sound come from a different pack to try combinations. Hover a cell for its prompt.
- `sfx.ts` trims each sample's leading silence, matches loudness (capped, and silent takes are skipped), varies pitch
  slightly and never repeats the same take back to back. Packs load on demand; until a sample is ready (or if it's
  missing) an effect falls back to the Tabletop sample, then to a small synth.

Companion voices are not part of a pack (they live in `public/sfx/companions/<id>/`, so switching pack never changes a
voice). They're made the same way, but a human picks the keepers:

```bash
node scripts/build-companion-sfx.mjs hex                # 3 candidates per slot into scripts/roster/voice-candidates/hex/ (gitignored)
node scripts/build-companion-sfx.mjs hex hello poke1    # only these slots (--candidates N, --force)
node scripts/build-voice-audition.mjs hex               # checks them (audible, clipping, treble) and writes the audition page
```

`src/shared/companionKit.json` holds each companion's voice signature, the shared per-slot emotions and the speech lines (`companionKit.ts` types it and defines the slots: 7 poke steps, pickup, drop, 6 emote tones). With `npm run dev`
running, open `/scripts/roster/voice-candidates/audition`, tick the picks and copy them. Copy the keepers to
`public/sfx/companions/<id>/<slot>.mp3` (`<slot>-1/-2.mp3` when a slot has several takes), then run
`node scripts/sync-companion-voices.mjs` so the game knows which files exist (a test fails until you do). Generating
needs the `elevenlabs` CLI and `ELEVENLABS_API_KEY`, and every candidate costs credits. Wording that sounds cute rather
than shrill: "plush-toy cartoon, low-to-mid pitched, mellow, never shrill", not "small, high-pitched" (needs ffmpeg).
Words like squeak, chirp, trill, peep, whistle, rustle or clack come out shrill; hums, grunts, mumbles, burbles and coos
stay mellow; "whoa", "nyah nyah" or "oof" make it sound human. **Sound Studio → Companions**
(`/dev/sound-studio?tab=companions`) plays every shipped voice; **Companion Lab** plays them with their reactions.

## Background music

Seven tracks (`public/music/*.m4a`, listed in `TRACKS` in `src/client/music.ts`) play in order, on a loop, from the
title screen through drafting to the table: the audio element lives in `music.ts`, not in a screen, so navigating
never interrupts it. Browsers don't allow audio before the player has interacted, so with music on it starts on the
first click or key press. The player is a small pill in the bottom-right corner (play/pause, and a button that opens
it); open, it's a bar along the bottom with a scrubber, previous/next, volume and a popup of all tracks, and the
screens end above it so it never covers the game. On/off, volume and open/minimized are remembered (`hd.music`);
the Settings dialog's Sound tab has the on/off and volume too. On load it tries to start straight away (browsers
allow that only sometimes; otherwise the first click does), unless it was paused last time. The speaker next to the
volume slider mutes the music without pausing it. Volumes: **Master** (default 70%) scales everything, **Music**
(50%) and **Effects** (100%) sit under it, all three in Settings → Sound (`volume.ts`, `hd.volume`). Muting effects
leaves the music alone. A new track is a file in `public/music/` plus an entry in `TRACKS` (a test checks they match).

## Roadmap

- **Checkpoint 1 (done):** lobby + share codes, cube import & validation, full draft with bots/timers/
  burns, deckbuilder, freeform 3D table (zones, tap, flip, transform, counters, tokens, life, scry/search,
  mulligan, dice, log), debug console.
- **Checkpoint 2:** (3D pack opening with particles and sound effects: done) Scryfall token art, table
  polish (box-select, card stacks/attachments, hand reordering, opponent-hand reveal, more table sounds).
- **Checkpoint 3:** real-set drafting (rarity slots, Play Booster / classic presets), spectators, text
  chat.
