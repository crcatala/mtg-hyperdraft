// The cast: the avatars and table companions every player (and bot) is dealt in the lobby.
// Pure data, shared by the client (art, names, hover cards) and the room engine (who may hold what).
// Art lives in public/roster/{avatars,companions}/<id>*.webp; the prompts that made it are in
// scripts/roster/roster.json. Ids are stored on `Player`, so never reuse or rename one.

export interface AvatarDef {
  id: string;
  name: string;
  title: string;
  race: string;
  /** Signature colour: the ring round their face and the shard behind their portrait. */
  color: string;
  /** Mana colours they lean on, as letters (e.g. "RW"). */
  mana: string;
  backstory: string;
  personality: string;
  quote: string;
  archetype: string;
}

export interface CompanionDef {
  id: string;
  name: string;
  species: string;
  color: string;
  personality: string;
  /** Planned animations (idle/hop/signature moves). Not the emote wheel: that is the kit in companionKit.ts. */
  moves: string[];
}

export const AVATARS: readonly AvatarDef[] = [
  { id: "sable", name: "Sable Quenby", title: "The Cardsharp", race: "Tiefling", color: "#e0344a", mana: "B",
    backstory: "Raised in the undercity card-halls of Vexmoor, Sable never lost a hand she was allowed to finish. She joined the cube circuit for the one thing she can't steal: a pack nobody has seen yet.",
    personality: "Sly, teasing, secretly loyal. Narrates her own picks like a heist.",
    quote: "\"I'll take that. Thanks for holding it.\"", archetype: "Aggro / tempo trickster" },
  { id: "cassian", name: "Cassian Vale", title: "The Gallant Duelist", race: "Human", color: "#ff6a2b", mana: "RW",
    backstory: "Disinherited prince of a kingdom that doesn't want him back, Cassian turned every duel into a stage and every stage into a following. He drafts the way he fences: loudly, beautifully, and at maximum risk.",
    personality: "Theatrical, generous, a terrible loser who loses gracefully anyway.",
    quote: "\"A flourish, friends — pass the pack, I'll make it count.\"", archetype: "Boros-style aggro" },
  { id: "mirabel", name: "Archivist Ondrak", title: "Keeper of the Long Shelf", race: "Human", color: "#45e0ff", mana: "U",
    backstory: "Ondrak has catalogued every card ever printed and holds a quiet grudge against the ones she can't find. She joined the table to see if the cube is as balanced as the rumors say. (It isn't.)",
    personality: "Dry, precise, devastatingly polite. Corrects your pronunciation of card names.",
    quote: "\"It's pronounced 'Jace.' Do try to keep up.\"", archetype: "Control / card advantage" },
  { id: "brannoch", name: "Brannoch Ashgrove", title: "The Hearth-Forged", race: "Dwarf", color: "#ff9d2e", mana: "R",
    backstory: "Brannoch forged his first deck out of a broken anvil and a bet. He believes every problem is a nail, and every nail has a good-natured explanation.",
    personality: "Boisterous, big-hearted, unshakeably optimistic. Treats every bad pick as a 'rustic charm'.",
    quote: "\"Burn it down and build it better!\"", archetype: "Red burn / artifacts" },
  { id: "aurelio", name: "Aurelio Sunmantle", title: "The Dawn Oath", race: "Human", color: "#f4c55b", mana: "W",
    backstory: "Aurelio took a vow to never leave a table with a sad face at it. He came to the cube to learn what the players love — and stayed because he lost the first game on purpose to cheer someone up.",
    personality: "Warm, earnest, relentlessly encouraging. Secretly extremely competitive.",
    quote: "\"Good game — wait, no, great game. Again?\"", archetype: "White weenie / lifegain" },
  { id: "pip", name: "Pip Gearhollow", title: "The Tinker-Prodigy", race: "Goblin", color: "#4be29a", mana: "UR",
    backstory: "Pip has been banned from three workshops and one moon. He builds contraptions that almost work, and drafts combos that definitely shouldn't. Somehow they both keep winning.",
    personality: "Hyperactive, inventive, easily distracted by shiny things. Has never once read the rulings.",
    quote: "\"What does this button — oh. Oh no. OH YES.\"", archetype: "Izzet combo / artifacts" },
  { id: "odalys", name: "Odalys Fenmoor", title: "Warden of the Greenmere", race: "Elf", color: "#7dd957", mana: "G",
    backstory: "Odalys speaks to the forest and the forest, politely, speaks back. She came to the table because a dying mana tree told her 'it's where the rest of the green decks are.'",
    personality: "Unhurried, kind, quietly savage. Will ramp, wait, and then end the game in one turn.",
    quote: "\"The seed was planted three turns ago. You just weren't looking.\"", archetype: "Green ramp / big creatures" },
  { id: "grusha", name: "Grusha Ironlute", title: "The Rowdy Skald", race: "Orc", color: "#ff5fa2", mana: "GW",
    backstory: "Grusha toured forty taverns and lost every hand of cards on purpose, because the songs were better when the table was happy. She joined the cube circuit after hearing it had a draft, and assumed that meant a band.",
    personality: "Loud, warm, impossible to embarrass. Turns every game into a ballad and every opponent into an honorary bandmate.",
    quote: "\"Sing it with me! Tap three lands for the chorus!\"", archetype: "Selesnya go-wide / tokens" },
  { id: "lucien", name: "Lucien Morvane", title: "The Midnight Patron", race: "Vampire", color: "#b8b0ff", mana: "WB",
    backstory: "Lucien has attended every great tournament for three centuries as a patron, never a player. He finally sat down because the last cube was frankly beneath him, then lost to a goblin. He has been back every week since.",
    personality: "Courtly, droll, secretly thrilled to be an underdog. Compliments opponents right before taking their life total.",
    quote: "\"Do go on. I so enjoy watching a plan fall apart.\"", archetype: "Orzhov drain / lifelink" },
  { id: "mizuki", name: "Mizuki Tsukikage", title: "The Moonlit Trickster", race: "Kitsune", color: "#b45bff", mana: "UB",
    backstory: "Mizuki has been a shrine guardian, a card dealer and a rumor, sometimes on the same night. Nobody remembers inviting her to the cube, but her name is on the sign-up sheet in everyone's handwriting.",
    personality: "Teasing, evasive, impossibly well-informed. Bluffs even when holding nothing, which is its own bluff.",
    quote: "\"Was that my card? Was it ever?\"", archetype: "Dimir illusions / tempo" },
];

export const COMPANIONS: readonly CompanionDef[] = [
  { id: "foil", name: "Foil", species: "Pack Rat", color: "#c9a0ff",
    personality: "Hoarder, optimist, tiny gambler. Squeaks with delight at foil cards.",
    moves: ["Hug the card", "Cape flourish", "Nibble the pack", "Faint on a bad pick"] },
  { id: "cinder", name: "Cinder", species: "Ember Drakeling", color: "#ff7a3d",
    personality: "Overeager, easily offended, loyal. Sneezes small fireballs when excited.",
    moves: ["Sneeze (fire puff)", "Flap hover", "Pout with smoke", "Curl up and sleep on the card"] },
  { id: "folio", name: "Folio", species: "Tome Mimic", color: "#8f6bff",
    personality: "Know-it-all, curious, bites when ignored. Whispers rules trivia.",
    moves: ["Flip open and gasp", "Snap shut (hide)", "Page-flutter dance", "Ribbon tongue"] },
  { id: "gloop", name: "Gloop", species: "Mana Slime", color: "#45e0ff",
    personality: "Sleepy, affectionate, absorbs things by accident. Glows brighter when you tap mana.",
    moves: ["Wobble", "Squish flat", "Absorb a token", "Glow pulse"] },
  { id: "sprout", name: "Sprout", species: "Mandrake Sapling", color: "#7dd957",
    personality: "Shy, gentle, dramatic when uprooted. Screams (cutely) when you shuffle.",
    moves: ["Bloom the flower", "Hide in the pot", "Wave leaf", "Tiny scream"] },
  { id: "wick", name: "Wick", species: "Candle Wisp", color: "#f4c55b",
    personality: "Cozy, spooky-but-sweet, afraid of drafts. Flame flickers with mood.",
    moves: ["Flicker (nervous)", "Flame flare (excited)", "Drip melt", "Blow out (sleep)"] },
  { id: "crit", name: "Crit", species: "d20 Golem", color: "#ff5d6c",
    personality: "Steady, goofy, takes everything as a roll. Insists a natural 20 is always imminent.",
    moves: ["Roll tumble", "Nat-20 cheer", "Nat-1 sad slump", "Stomp"] },
  { id: "nimbus", name: "Nimbus", species: "Star Whale Calf", color: "#6cc8ff",
    personality: "Dreamy, wise beyond its size, drifts toward whoever is having a bad day.",
    moves: ["Drift in a circle", "Sing (sparkles)", "Rain a little", "Yawn"] },
  { id: "hex", name: "Hex", species: "Witch's Cat", color: "#ffd24a",
    personality: "Aloof, curious, loves sitting on whichever card you were about to read. Knocks tokens off the table on purpose.",
    moves: ["Loaf (sit on the card)", "Knock a token off", "Tail-star twirl", "Slow blink"] },
  { id: "ribbit", name: "Sir Ribbit", species: "Frog Knight", color: "#7dd957",
    personality: "Brave, wobbly and very dramatic. Challenges every creature to a duel, then hides behind the shield.",
    moves: ["Throat-bubble croak", "Shield up", "Sword salute", "Tongue-snatch a token"] },
];

const AVATAR_BY_ID = new Map(AVATARS.map((a) => [a.id, a]));
const COMPANION_BY_ID = new Map(COMPANIONS.map((c) => [c.id, c]));

export const avatarDef = (id: string | undefined): AvatarDef | undefined => (id ? AVATAR_BY_ID.get(id) : undefined);
export const companionDef = (id: string | undefined): CompanionDef | undefined => (id ? COMPANION_BY_ID.get(id) : undefined);
export const isAvatarId = (id: string) => AVATAR_BY_ID.has(id);
export const isCompanionId = (id: string) => COMPANION_BY_ID.has(id);

/** A random id from `ids` that isn't in `taken`, or (if everything is taken) any random one. */
export function pickFree(ids: readonly string[], taken: ReadonlySet<string>, rng: () => number): string {
  const free = ids.filter((id) => !taken.has(id));
  const pool = free.length > 0 ? free : ids;
  return pool[Math.floor(rng() * pool.length)];
}

export const AVATAR_IDS = AVATARS.map((a) => a.id);
export const COMPANION_IDS = COMPANIONS.map((c) => c.id);

/** The accent colour for a player with no avatar (the hooded stranger shown in their place). */
export const MYSTERY_COLOR = "#8d86a8";

/** How far a colour variant's hue is turned: golden-angle steps keep successive variants well apart. */
export function variantHue(variant: number): number {
  return variant <= 0 ? 0 : Math.round((variant * 137.508) % 360);
}

/** `hex` with its hue turned for the given variant (0 returns it unchanged). */
export function variantColor(hex: string, variant: number): string {
  const turn = variantHue(variant);
  if (turn === 0) return hex;
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = (h + turn) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

/** The smallest variant number not in `used`. */
export function lowestFreeVariant(used: Iterable<number>): number {
  const taken = new Set(used);
  let v = 0;
  while (taken.has(v)) v++;
  return v;
}
