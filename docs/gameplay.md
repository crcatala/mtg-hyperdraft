# Gameplay guide

- [Drafting and importing cubes](#drafting-and-importing-cubes)
- [Tabletop controls](#tabletop-controls)
- [Avatars and companions](#avatars-and-companions)
- [The Treatomancer](#the-treatomancer)
- [Tables and environments](#tables-and-environments)
- [UI themes](#ui-themes)
- [Pack opening and sound](#pack-opening-and-sound)
- [Background music](#background-music)

## Drafting and importing cubes

The host picks what to draft in the lobby:

- **Starter cube:** the bundled Hypercube (384 cards), which loads instantly with no lookups.
- **Draft a set:** any Magic set by name or code (e.g. `set:WTH`), with one plain booster printing per
  card (no alt art, promos or basics).
- **Your own list:** a CubeCobra link, or a pasted list (`Name`, `4 Name`, Arena `Name (SET) 123`, or a
  CubeCobra CSV export).

Draft settings cover packs per player, cards per pack, picks and burns per turn, passing direction (left,
right, left or always left) and an optional pick timer. Empty seats can be filled with bot drafters, which
score cards by CubeCobra ELO, rarity and colour commitment. After the draft everyone builds a deck from
their pool with unlimited basics, auto lands and an optional auto-build.

## Tabletop controls

Press <kbd>?</kbd> on the table for the full list. Highlights: drag cards anywhere (onto piles, back to
hand), click a hand card to select it and again to zoom in (← → browses your hand; playing is always a
drag or a menu pick), double-click to tap / draw, right-click for menus (counters, face down, scry, search, mill,
mulligan…), <kbd>T</kbd>/<kbd>Space</kbd> tap, <kbd>F</kbd> face down, <kbd>G</kbd>/<kbd>X</kbd>/<kbd>H</kbd>
graveyard/exile/hand, <kbd>D</kbd> draw, <kbd>U</kbd> untap all, <kbd>N</kbd> end turn, arrows/<kbd>Q</kbd>
<kbd>E</kbd>/wheel for the camera, <kbd>1</kbd>–<kbd>4</kbd> view from any player's seat (1 is yours),
<kbd>V</kbd> overhead view, <kbd>Tab</kbd> ping the spot under the pointer (everyone sees and hears it, like
Tabletop Simulator), **Scene** (toolbar) for the table and environment, for everyone. Card names in the game
log are links: hover for a preview, click to zoom in.

**Double-faced cards** show both faces in hover previews and have a ⟲ button to turn them over everywhere
(draft, picks, deckbuilder, zoom view — <kbd>F</kbd> there — and your hand, where <kbd>R</kbd> works too). A card
turned over in your hand enters the battlefield on that face.

**Rules help:** the zoom view lists the card's mechanics (Scryfall's keywords: Flying, Scry, Landfall…)
and rules-relevant types. Hovering one (tapping, on touch screens) explains it in place with the reminder
text and opening summary from the community [MTG Wiki](https://mtg.wiki), fetched on first use and cached;
clicking opens the full wiki page in a new tab. A **View detailed rulings** button fetches the card's
official rulings from Scryfall, only when clicked, and keeps them for the session. Hidden cards show none
of this. The ⌃ button hides the panel (remembered per browser); a book button next to the card name brings
it back.

The table is freeform: there's no rules engine, so players handle the game themselves, just like at a
real table. The server makes sure nobody sees cards they shouldn't (hands, libraries, face-down cards).

## Avatars and companions

Players can give themselves an **avatar** (a character portrait) and a **companion** (a little creature
that stands in front of their mat). Both are optional: a human starts with neither, shows up as a hooded
stranger, and can pick in the lobby (**Avatar…**, **Companion…** or **Surprise me** on the Players panel).
Bots are dealt a random pair. A choice is remembered in the browser for the next room. The player's name
stays their main identity everywhere; hovering anyone's face (lobby, draft ring, deckbuilder, table HUD)
reveals the character behind it. Several players may pick the same avatar or companion; each extra holder
gets a different colour variant.

Each companion has its own personality, voice, signature moves and lines:

- **Poking:** anyone can tap any companion at the table. Each tap climbs a 7-step ladder of reactions and
  speech-bubble lines, ending in a cheeky finale and a sulk.
- **Emotes:** right-click your own companion (or press <kbd>W</kbd>) for a wheel of six emotes: cheer,
  love, oops, silly, sass and taunt. Pick with a click, a right-drag-and-release, or the keys 1-6 / arrows
  + Enter. Your companion plays the emote's voice and reaction and says its line in a large bubble, for
  everyone. One emote per 1.5 s per player. **Edit lines** under the wheel (or <kbd>E</kbd>) rewrites any
  of your six lines for this tab (a reload brings the defaults back); there's no content filter, by design.
- **Pick up and drop:** press and hold your own companion to pick it up, carry it, and let go anywhere on
  the table except another player's mat (your own mat is fine). Others see it carried live. **Home** in
  the wheel's centre (<kbd>H</kbd>) sends it back by your mat.
- **Settings → Companions** has two switches, remembered per browser: **Companion sounds** (off: no
  voices, and none downloaded; companions still react) and **Companion speech** (off: no bubbles, emotes
  included). They only change what you see and hear, never what is sent.
- **Accessibility:** the wheel is a labelled menu that works from the keyboard alone (<kbd>W</kbd>,
  <kbd>1</kbd>-<kbd>6</kbd> or arrows/Tab + <kbd>Enter</kbd>, <kbd>Esc</kbd>), and focus goes back where it
  was when it closes. Emotes are read out politely by screen readers ("Alice's Hex: Ten lives. You have
  one."); pokes and pick-ups are not. With reduced motion, companions, glyphs, bubbles, the wheel and the
  lobby preview hold still (fades only).

## The Treatomancer

A wizard's gumball machine sits on the table out by the rim, left of each player's mat. **Click it (or
press <kbd>B</kbd>)** for its menu: ten treats, from a Cursed Left Sock (1 glimmer) to The Golden Pickle
(6). Everyone gets a pouch of **12 glimmers** per game. Pick one and **Feed it & launch!**: the machine
rattles and winds up, fires a capsule in a high arc onto a random spot anywhere on the table (mats and
cards included; never on a machine), and it pops open. Every companion at the table races for it at its
own random speed (the odd one gets the zoomies, some dawdle, some trip and say so). The first one there
eats it, or hugs it if it's a keepsake, and says one of its own three lines about it; the rest pout,
grumble, and everyone trots home.

- **One player at a time.** Opening the menu takes hold of the machine (for up to 60 s); everyone else
  sees "Alice is browsing treats…" with her face over their machine, and a click on theirs is turned away.
  Closing the menu, buying, the hold running out or Alice dropping out lets go.
- **Hands off during the show.** From the purchase until everyone's home, nobody can poke, carry or emote
  with a companion, or use the machine.
- **The same race on every screen.** Every player sees the same speeds, trips and winner.
- **Move it.** Hold or drag the machine to pick it up (a tap still opens the menu): held by its hat, it
  swings as you carry it, glows red over a mat, and lands with a bump where you let go, or goes back with
  a shake if it can't stand there. Each player has their own copy of the machine, so moving yours moves it
  only for you.
- Solo games only have your own companion at the table (bots don't sit down), so it races alone.

## Tables and environments

The 3D table comes in three designs and stands in one of three environments, picked from the **Scene**
button on the table's toolbar (next to Help). The choice is shared: anyone at the table can change it,
everyone sees the change at once, and the game log says who did it. It's saved by the room, so it
survives reloads and carries over to the next game in that room. It's purely cosmetic: switching never
moves a card, a mat, a pile or a companion.

| Tables | Environments |
|---|---|
| **Classic felt**: round walnut table, green baize, padded leather rail | **Tavern hearth**: fireplace, bar, barrels, mana-coloured shields, a sleeping cat |
| **Runestone**: twelve-sided slate slab ringed with glowing runes, floating crystals | **Arcane library**: bookcases, moonlit windows, a turning summoning circle, floating candles and books, an orrery |
| **Oak & brass**: square oak card table with a leather inlay and a candle in each corner | **Moonlit grove**: standing stones, swaying pines, fireflies, glowing mushrooms, an owl |

When the table opens, the camera starts wide on the room and glides down to your seat (any camera input,
or reduced motion, skips it). The **title screen** shows a table set for a game in one of the
environments, with the camera slowly circling it; each UI theme has its own pairing.

## UI themes

The screens and the table HUD (not the 3D table itself) come in three themes. **Game Night** (walnut,
brass and oxblood) is the default, **Signal** is graphite with a lime accent, and **Arcane** is the
original violet-and-gold look. Pick one in Settings (the gear in the top bar, or beside Help on the
table), at the bottom of the home page, or cycle with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>; the
choice is remembered per browser.

## Pack opening and sound

On the Draft screen a fresh pack is a real 3D foil booster. It drops in, catches the light as the pointer
moves, and is **torn open by dragging across the top** (or click it / press <kbd>Space</kbd>): the strip
peels away behind the tear front, light leaks out, and on the last inch the strip flies off and the cards
slide out to be dealt. Packs are themed (Game Night, Signal and Arcane each have their own foil). If WebGL
isn't available, a simpler CSS pack is used instead. Reduced motion skips the opening entirely.

Sound effects come in switchable **sound packs**: **Tabletop** (the default: wood, cardstock and soft
chimes), **Arcane** (crystal chimes, harp), **Library** (parchment, leather, a music box) and **Grove**
(leaves, twigs, kalimba). Pick one in Settings (it plays a short sample); the choice is remembered.

## Background music

Seven tracks play in order, on a loop, from the title screen through drafting to the table, without
interruption between screens. Browsers don't allow audio before you've interacted with the page, so with
music on it starts on the first click or key press. The player is a small pill in the bottom-right corner;
open, it's a bar along the bottom with a scrubber, previous/next, volume and a list of all tracks.
Settings → Sound has three volumes: **Master** (default 70%) scales everything, with **Music** (50%) and
**Effects** (100%) under it.
