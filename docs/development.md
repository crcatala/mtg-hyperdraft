# Development

- [Local setup](#local-setup)
- [Debug tools](#debug-tools)
- [Tests and checks](#tests-and-checks)
- [Avatars and companions](#avatars-and-companions)
- [The Treatomancer](#the-treatomancer)
- [UI themes](#ui-themes)
- [Tables and environments](#tables-and-environments)
- [Sound effects](#sound-effects)
- [Companion voices](#companion-voices)
- [Background music](#background-music)
- [Bundled cubes](#bundled-cubes)

See [Architecture](architecture.md) for the code map and how the pieces fit together.

## Local setup

```bash
npm install
npm run dev          # http://localhost:3000 — Vite + the Worker + Durable Objects, all local
```

No Cloudflare account is needed for local development: the Cloudflare Vite plugin runs the Worker and
Durable Objects inside `workerd` on your machine. The first `npm run dev` copies `.dev.vars.example` to
`.dev.vars` (local secrets, gitignored), which includes a dev invite: open
<http://localhost:3000/?invite=dev-invite-key> once to be able to host online rooms locally. To try public
rooms, uncomment `PUBLIC_ROOMS_ENABLED` (and optionally the Turnstile test keys) in `.dev.vars` and restart
`npm run dev`. `.dev.vars` is only created once, so copy those lines from `.dev.vars.example` if yours is older.

**Multiple players on one machine:** open the room link with `?as=2`, `?as=3`… in other tabs. Each alias
is a separate player identity (the debug console has links).

**From another machine:** the dev server only listens on `localhost`. Pass `--host` and list the hostnames you
will use in the `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` environment variable (comma-separated; a leading dot
allows subdomains; IP addresses always work). Set it in your shell, since Vite doesn't read it from `.env` files:

```bash
export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=my-machine,.example.internal
npm run dev -- --host
```

Local dev uses a well-known invite key, so only expose it on a trusted network.

## Debug tools

The debug console is hidden from players: open the app once with `?debug` (e.g.
`http://localhost:3000/?debug`) and this browser remembers it; `?debug=0` or its **Turn off** button hides
it again. Then press <kbd>`</kbd> (backtick) or the bug icon for the console:

- **Quickstart** loads the starter cube and fills the seats with bots; **Finish draft** auto-picks for
  everyone; **Skip to table** jumps straight to the tabletop with auto-built decks. Quickstart, cube
  import and Add bot are host-only; the other jump buttons currently work for any player in the room.
- **Slow-motion card animations** runs every card animation 6× slower for tuning them.
- **Play as another seat** opens `?as=N` tabs.

The same tools work in online rooms. Solo playtest: click **Play solo vs bots** on the home page, then
**Quick start** (loads the bundled Hypercube and readies you up).

Labs, linked from the debug console:

- **Companion Lab** (`/dev/companion-lab`) plays every reaction of every companion, slowed down or four at
  once.
- **Scene Lab** (`/dev/scene-lab`) shows any table in any environment at 1-4 seats with stand-in mats:
  from your seat, zoomed out, overhead, orbiting, or with the title camera, plus draw calls and frame rate.
  `?table=&env=&seats=&cam=` preset it; `?hide=sprites,points,transparent,env,lights` hides kinds of
  objects to see what costs what.
- **Sound Studio** (`/dev/sound-studio`) auditions the sound packs: it plays the draft's sound sequences
  (opening a pack, making a pick, browsing cards) with the game's own timings, plays any sound from any
  pack, and lets each sound come from a different pack to try combinations. Hover a cell for its prompt.
  `?tab=companions` plays every shipped companion voice.

URL parameters for previews (none of them change saved settings):

| Parameter | Effect |
|---|---|
| `?theme=gamenight\|signal\|arcane` | Preview a UI theme for one visit |
| `?sounds=<pack>` | Preview a sound pack for one visit |
| `?pack=css` | Force the simple CSS pack instead of the 3D booster |
| `?as=N` | Play as another player identity in this tab |
| `?debug` / `?debug=0` | Show / hide the debug console in this browser |

## Tests and checks

```bash
npm test             # unit tests (draft engine, import parser, deck helpers, table, room flow)
npm run typecheck    # client + worker + shared
npm run build        # production build (dist/)
```

CI runs all three on every pull request and push to `main`.

## Avatars and companions

- The cast lives in `src/shared/roster.ts`, and the art in `public/roster/{avatars,companions}/`
  (`<id>.webp` plus a face crop or small icon; `mystery*.webp` is the hooded default). Ids are stored on
  each `Player`, so never rename or reuse one. Rooms saved before this existed load fine.
- Whoever holds an avatar or companion second (or third...) gets a different colour variant, stored as
  `avatarVariant` / `companionVariant`: a turned hue for the ring and portrait background, and for the
  companion's picture. The first holder keeps the original.
- `setLook` (lobby only) sets or clears either choice; the room engine in `shared/room.ts` does all the
  bookkeeping, so solo mode behaves the same.
- A companion is one flat picture (`table/CompanionFigure.tsx`) brought to life by procedural motion: 18
  reactions (hello, the 7-step poke ladder, sulk, pickup, carry, drop, 6 emotes) built from shared motion
  primitives and effect glyphs (`table/companionMotion.ts`, pure and tested), a body style per companion and
  signature moves drawn from its `moves` (`table/companionReactions.ts`). `playReaction(playerId, slot)`
  (`table/companionPlayback.ts`) plays one on anyone's companion.
- **Pokes** (`table/pokeLadder.ts`, `table/companionPoke.ts`) and **emotes** (`table/companionEmote.ts`,
  wheel in `table/EmoteWheel.tsx`) are relayed by the room like pings and stored nowhere. Bubbles and
  table voices go through `say`/`voice` in `table/companionTalk.ts`.
- **Edited emote lines** live in this tab's memory (`table/emoteLines.ts`, `table/EmoteLinesDialog.tsx`).
  A rewritten line travels with the emote; client and room both clean it with `shared/emoteText.ts` (one
  line, no invisible or bidi characters, 60 characters at most), and React shows it as plain text.
- **Carrying** is relayed live, not stored; where it lands is the one thing stored
  (`Player.companionAt`, one write per drop, checked by the room with the same `petSpotValid` in
  `shared/tableLayout.ts`). Code: `table/companionCarry.ts`, `table/petGesture.ts`.
- **Settings → Companions** switches are remembered per browser (`companionPrefs.ts`, `hd.companions`).
  The gates are `say`/`voice` in `table/companionTalk.ts` and `sayHello` in `companionVoice.ts`; the lab
  and sound studio always play voices.
- `tests/companionAudit.test.ts` checks what shipped against the plan: 10 companions × (16 voice slots, 15 lines,
  18 reactions) = 160 / 150 / 180. Run it with `--reporter=verbose` to see the per-companion counts.
- To add a character, add an entry to `roster.ts` and its images; `tests/roster.test.ts` checks that
  every entry has its files. The prompts and style notes used to generate the current art are in
  `scripts/roster/roster.json`.

## The Treatomancer

- **The same race on every screen.** The room picks a seed and a landing spot and sends them with the
  racers' start spots (`treat`); `planShow` in `shared/treats.ts` works out every speed, trip and the winner
  from that alone, so nothing about the race itself goes over the wire. The glimmers left are stored per
  player on the table (`TablePlayer.glimmers`, one write per purchase, logged). The show's end time is saved
  in that same write (`RoomState.treatShowUntil`), so a room rebuilt mid-show (hibernation, a deploy) stays
  locked; the browsing hold is in memory only (a purchase doesn't need one).
- **Moving the machine** is one stored `setMachinePos` per move (`TablePlayer.machineAt`, cleared by a new
  game); not mid-show. It must stand on the table, off every mat (`machineFits`). Code:
  `table/machineCarry.ts`, like the companion carry.
- Each player has their own copy of the machine (`machineSpot` by default; solo, past the far corner of the
  mat, where its closer camera can see it): the cameras frame each mat too tightly for one shared machine
  to be in everyone's shot. Only where the capsule flies *from* differs between screens; landings keep
  clear of every seat's machine, wherever it stands.
- Code: `shared/treats.ts` (catalog, lines, the race planner, where it stands and lands), `table/treatShow.ts`
  (the beats: sounds, reactions, voices, bubbles), `table/treatState.ts`, `table/Treatomancer.tsx` (the
  procedural machine), `table/TreatFlight.tsx` (capsule and treat), `table/TreatMenu.tsx` + `treats.css`
  (menu and tags). The race reactions (`alert`, `dash`, `trip`, `feast`, `hug`, `pout`) are in
  `TREAT_REACTIONS` in `table/companionReactions.ts`; companions reuse their existing voices (cheer to win,
  oops to trip, bothered to lose).
- Art: `public/treats/<id>.webp` (generated with GPT Image, transparent). Sounds: `public/treats/sfx/` from
  the prompts in `scripts/sfx/treats.json` (`node scripts/build-treat-sfx.mjs [names…]`, needs
  `ELEVENLABS_API_KEY`).

## UI themes

`styles.css` + `screens.css` are the base and the Arcane look. Each other theme is one file in
`src/client/themes/`, scoped to `<html data-theme="…">`, that redefines the tokens in `:root` (colours,
fonts, radius, and the optional surface tokens listed there) and restyles components where needed. To add
one, create `themes/<id>.css`, import it in `main.tsx`, add it to `THEMES` in `theme.ts` and to the pre-paint
list in `index.html` (`tests/theme.test.ts` checks these agree), and add its fonts to `index.html` (browsers
only download the font files a page actually uses).

## Tables and environments

The choice is stored by the room (`RoomState.scene`, one write per change). Every table is drawn around
the same round play area (`tableRadius` in `shared/tableLayout.ts`), which clears the outer corners of every
mat by a margin at any seat count; a companion can be put down anywhere on it. Environments keep the
lighting on the table about the same (cards read the same everywhere); only its colour shifts with the
mood. The title screen's pairings are in `scene/titleScenes.ts` (Game Night is the oak table by the tavern
hearth, Arcane the runestone in the library, Signal the felt table in the grove), behind a scrim that keeps
the menus readable (`--home-scrim`, per theme). Without WebGL, Home keeps its plain background.

- Everything is built in code: low-poly geometry and canvas-drawn textures (`scene/sceneTextures.ts`, drawn once
  from a fixed seed and cached), no model or image files. Small things move (flames, fireflies, the cat's breathing,
  the orrery, the owl, swaying trees); with reduced motion everything holds still.
- They're kept cheap: repeated things are instanced (chairs, trees, books, mushrooms), every candle in a scene is
  drawn in three draw calls (`CandleBatch` in `scene/bits.tsx`), the floor's light falloff is baked into vertex
  colours, and the table and title canvases drop to 1x pixel density if the frame rate can't keep up.
- To add one: an entry in `TABLE_STYLES` or `ENVIRONMENTS` (`shared/scene.ts`), a component in `scene/tables.tsx` or
  a new `scene/<id>.tsx` wired into `scene/Environment.tsx` (with its mood: background, fog and light colours), and
  a swatch in `screens.css` (`.scene-swatch.s-<id>`). A table must draw its play surface as exactly the
  `tableRadius` disc and pass it the `surface` handlers. Ids are stored in rooms, so never rename or reuse one;
  unknown ids fall back to the default.

## Sound effects

The 3D pack lives in `src/client/pack/`. Each sound pack is a folder of short samples in
`public/sfx/<pack>/`, generated with the
[ElevenLabs sound-effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
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
- `sfx.ts` trims each sample's leading silence, matches loudness (capped, and silent takes are skipped), varies pitch
  slightly and never repeats the same take back to back. Packs load on demand; until a sample is ready (or if it's
  missing) an effect falls back to the Tabletop sample, then to a small synth.

## Companion voices

Companion voices are not part of a pack (they live in `public/sfx/companions/<id>/`, so switching pack never
changes a voice). They're made the same way, but a human picks the keepers:

```bash
node scripts/build-companion-sfx.mjs hex                # 3 candidates per slot into scripts/roster/voice-candidates/hex/ (gitignored)
node scripts/build-companion-sfx.mjs hex hello poke1    # only these slots (--candidates N, --force)
node scripts/build-voice-audition.mjs hex               # checks them (audible, clipping, treble) and writes the audition page
```

`src/shared/companionKit.json` holds each companion's voice signature, the shared per-slot emotions and the
speech lines (`companionKit.ts` types it and defines the slots: 7 poke steps, pickup, drop, 6 emote tones).
With `npm run dev` running, open `/scripts/roster/voice-candidates/audition`, tick the picks and copy them.
Copy the keepers to `public/sfx/companions/<id>/<slot>.mp3` (`<slot>-1/-2.mp3` when a slot has several
takes), then run `node scripts/sync-companion-voices.mjs` so the game knows which files exist (a test fails
until you do). Generating needs the `elevenlabs` CLI, `ffmpeg` and `ELEVENLABS_API_KEY`, and every
candidate costs credits.

Prompt wording that sounds cute rather than shrill: "plush-toy cartoon, low-to-mid pitched, mellow, never
shrill", not "small, high-pitched". Words like squeak, chirp, trill, peep, whistle, rustle or clack come
out shrill; hums, grunts, mumbles, burbles and coos stay mellow; "whoa", "nyah nyah" or "oof" make it
sound human. **Sound Studio → Companions** (`/dev/sound-studio?tab=companions`) plays every shipped
voice; **Companion Lab** plays them with their reactions.

## Background music

Tracks are `public/music/*.m4a`, listed in `TRACKS` in `src/client/music.ts`. The audio element lives in
`music.ts`, not in a screen, so navigating never interrupts it. On/off, volume and open/minimized are
remembered (`hd.music`); master, music and effects volumes live in `volume.ts` (`hd.volume`). A new track
is a file in `public/music/` plus an entry in `TRACKS` (a test checks they match).

## Bundled cubes

Cubes bundled as static snapshots live in `public/presets/*.json` and are listed in
`src/shared/presets.ts`. Refresh them, or add a new one, with `npm run presets:build`.
