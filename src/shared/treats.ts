// The Treatomancer: a gacha-style machine by the table that sells companion treats for glimmers. Each player gets
// a fixed purse of glimmers per game; a treat bought is shot out of the machine onto a random spot of the table
// (mats and cards included), every companion at the table races for it, and the first there eats it (or hugs it).
//
// Pure and shared: the room engine validates purchases with it and works out the winner for the log, and every
// client plays the very same race from the `TreatShowSpec` the room sends (same seed → same speeds, trips and
// winner), so nothing about the race itself has to travel over the wire.

import { mulberry32, type Rng } from "./rng";
import { localToTable, MAT_D, MAT_W, tableRadius, tableToLocal, type Vec2 } from "./tableLayout";

/** What every player starts a game with. */
export const GLIMMER_START = 12;
/** How long one player may hold the machine (browsing its menu) before it lets go by itself. */
export const VEND_HOLD_MS = 60_000;

export interface TreatDef {
  id: string;
  name: string;
  /** In glimmers. */
  cost: number;
  blurb: string;
  /** Eaten (crunch) or kept and cherished (a hug). */
  kind: "eat" | "keep";
  /** Accent for its card in the menu and its glow on the table. */
  color: string;
}

export const TREATS: readonly TreatDef[] = [
  { id: "cursed-sock", name: "Cursed Left Sock", cost: 1, kind: "keep", color: "#a46bff", blurb: "The right one is still out there. Searching." },
  { id: "traffic-cone", name: "Tiny Traffic Cone", cost: 1, kind: "keep", color: "#ff8a2b", blurb: "Royalty, apparently. Nobody knows how it got in the machine." },
  { id: "moonlit-macaron", name: "Moonlit Macaron", cost: 2, kind: "eat", color: "#b59cff", blurb: "Baked under a full moon. Tastes faintly of wishes." },
  { id: "suspicious-soup", name: "Suspicious Soup", cost: 2, kind: "eat", color: "#7bd957", blurb: "It's looking at you. Eat it anyway." },
  { id: "mana-donut", name: "Five-Mana Donut", cost: 2, kind: "eat", color: "#ff7ab6", blurb: "Tap it for one bite of each colour." },
  { id: "dragon-dumpling", name: "Dragonfruit Dumpling", cost: 3, kind: "eat", color: "#ff5d8f", blurb: "Still smouldering. Blow on it first." },
  { id: "rubber-duck", name: "Distinguished Duck", cost: 3, kind: "keep", color: "#ffd84a", blurb: "Not food. Insists on being cherished, and addressed as Sir." },
  { id: "cheese-wheel", name: "Cheese Wheel of Fortune", cost: 4, kind: "eat", color: "#ffc23d", blurb: "Pull the lever. Every outcome is cheese." },
  { id: "bottled-storm", name: "Bottled Thunderstorm", cost: 5, kind: "keep", color: "#5fb8ff", blurb: "Shake well. Actually, do not shake at all." },
  { id: "golden-pickle", name: "The Golden Pickle", cost: 6, kind: "keep", color: "#ffd36b", blurb: "Legendary. Briny. Worth more than your whole deck." },
];

const TREAT_BY_ID = new Map(TREATS.map((t) => [t.id, t]));
export const TREAT_IDS = TREATS.map((t) => t.id);
export const treatDef = (id: string | undefined): TreatDef | undefined => (id ? TREAT_BY_ID.get(id) : undefined);
export const isTreatId = (id: string): boolean => TREAT_BY_ID.has(id);

/** "a Moonlit Macaron", "an ...", or just "The Golden Pickle" (a name that brings its own article). */
export const aTreat = (t: TreatDef): string => (/^the /i.test(t.name) ? t.name : `${/^[aeiou]/i.test(t.name) ? "an" : "a"} ${t.name}`);
/** "the Moonlit Macaron", or "The Golden Pickle" as it is. */
export const theTreat = (t: TreatDef): string => (/^the /i.test(t.name) ? t.name : `the ${t.name}`);

/** A player's glimmers left (games saved before treats existed start full). */
export const glimmersLeft = (p: { glimmers?: number } | undefined): number => p?.glimmers ?? GLIMMER_START;

// --- what companions say ------------------------------------------------------------------------

/** Per companion: three ways to celebrate winning a treat (`{treat}` is its name) and two for tripping. */
export const TREAT_LINES: Readonly<Record<string, { win: readonly string[]; trip: readonly string[] }>> = {
  foil: { win: ["MINE! {treat} for the hoard!", "Squeak! {treat}! Jackpot!", "Is {treat} foil? It's foil to me."], trip: ["My cape! My beautiful cape!", "Squeak— I meant to do that."] },
  cinder: { win: ["{treat}! Lightly toasted. Perfect!", "I'd burn the world for {treat}!", "Achoo— sorry. Flame-grilled {treat}."], trip: ["Tail-first! TAIL-FIRST!", "I tripped on purpose. To look cool."] },
  folio: { win: ["Page 42: {treat} belongs to me.", "{treat}! A rare first edition!", "Filed {treat} under D. For Delicious."], trip: ["Ow! Who shelved the floor here?", "Dog-eared. Utterly dog-eared."] },
  gloop: { win: ["Blorp. {treat} lives in me now.", "Absorbed: one {treat}. Glowing!", "Squish! {treat}! Gloop loves it!"], trip: ["Splat. Gloop is floor now.", "Wobbled. Toppled. Still cute."] },
  sprout: { win: ["F-for me? {treat}? Thank you!", "I'll plant {treat}. Hehe.", "Oh! {treat}! I'm blooming!"], trip: ["Eep! My roots tangled!", "I'm okay! ...I'm a little dirt."] },
  wick: { win: ["Mmm, {treat}. So cozy.", "My flame's dancing! {treat}!", "{treat}? You light me up!"], trip: ["Whoa— a draft! Don't blow!", "Dripped. Slipped. Still lit!"] },
  crit: { win: ["Rolled for {treat}. NAT 20!", "Critical hit on {treat}!", "+5 to snacks. {treat} acquired."], trip: ["Rolled a 1 on running. Ow.", "Dex save failed. Classic."] },
  nimbus: { win: ["{treat}... like a falling star.", "Mmm. {treat} tastes like tides.", "I'll hum a song for {treat}."], trip: ["Drifted. Then... floored.", "Oops. Even whales belly-flop."] },
  hex: { win: ["{treat} was always mine.", "Acceptable. {treat} may stay.", "I'll knock {treat} off later."], trip: ["I meant to lie down here.", "Nobody saw that. Nobody."] },
  ribbit: { win: ["{treat} is won! For honour!", "I claim {treat} for the realm!", "Ribbit! {treat}, fit for a knight!"], trip: ["A tactical tumble! Ribbit!", "My armour! Too heavy! Oof!"] },
};
const FALLBACK_LINES = { win: ["{treat}! Yay!", "All mine: {treat}!", "Thank you for {treat}!"], trip: ["Whoops!", "Oof!"] };

/** What everyone else says once it's gone (a few of them, picked at random). */
export const LOSER_LINES = ["So close!", "Aww...", "No fair!", "Rigged!", "Next time...", "Hmph.", "Was that a pickle?", "I was stretching."] as const;

/** A companion's win line `index` (0-2) for a treat, with the treat's name filled in. */
export function winLine(companion: string | undefined, index: number, treat: TreatDef): string {
  const lines = (companion && TREAT_LINES[companion]) || FALLBACK_LINES;
  return lines.win[((index % lines.win.length) + lines.win.length) % lines.win.length].replaceAll("{treat}", treat.name);
}

export function tripLine(companion: string | undefined, index: number): string {
  const lines = (companion && TREAT_LINES[companion]) || FALLBACK_LINES;
  return lines.trip[((index % lines.trip.length) + lines.trip.length) % lines.trip.length];
}

// --- the show ------------------------------------------------------------------------------------

/** A companion in the race: whose it is, which companion, and where it stands when the treat is bought. */
export interface Racer {
  id: string;
  companion: string;
  x: number;
  y: number;
}

/** Everything a show is played from: the same on every screen. */
export interface TreatShowSpec {
  by: string;
  treat: string;
  seed: number;
  /** Where the treat lands (table coordinates). */
  at: Vec2;
  racers: Racer[];
}

/** The fixed beats (seconds from the purchase): the machine shakes, fires, the treat flies, lands and pops open. */
export const BEATS = {
  /** The machine rattles and winds up until it fires. */
  launch: 2.3,
  /** Flight time to the table. */
  flight: 1.15,
  /** After landing: a bounce and the capsule popping open, then the race starts. */
  reveal: 0.6,
  /** Once it's taken: chewing, celebrating, the loser lines, before everyone heads home. */
  celebrate: 3.2,
  /** Everyone back to their spots. */
  home: 0.9,
} as const;
export const LAND_AT = BEATS.launch + BEATS.flight;
export const RACE_AT = LAND_AT + BEATS.reveal;

export interface Trip {
  /** Fraction of the way when it trips. */
  frac: number;
  /** How long it lies there (s). */
  dur: number;
  /** Which of its trip lines it says. */
  line: number;
}

export interface Run {
  id: string;
  companion: string;
  start: Vec2;
  /** Where it means to end up: at the treat (the winner) or around it. */
  stop: Vec2;
  /** When it sets off (s from the purchase). */
  go: number;
  /** Units per second. */
  speed: number;
  trip?: Trip;
  /** When it would reach `stop` (s from the purchase). */
  arrive: number;
  /** A loser line it says when it's over (index into LOSER_LINES), if any. */
  sulk?: number;
}

export interface ShowPlan {
  runs: Run[];
  /** Whose companion gets it (null: nobody's at the table, it just fizzles). */
  winner: string | null;
  winLine: number;
  /** When the winner reaches it (s from the purchase). */
  takenAt: number;
  /** Everyone heads home. */
  homeAt: number;
  /** The show is over. */
  endAt: number;
}

const DUD_LINGER = 2.4;
/** How close the winner gets (its feet just behind the treat), and the losers' ring around it. */
const WIN_GAP = 0.55;
const RING = 2.1;
/** How far a tripped companion tumbles forward. */
const TUMBLE = 0.6;

/** Seconds a run takes from setting off to covering `dist`, trip included. */
const runTime = (dist: number, speed: number, trip?: Trip) => dist / speed + (trip && trip.frac * dist + TUMBLE < dist ? trip.dur - TUMBLE / speed : 0);

/**
 * Works out the whole race from its spec: every companion's speed (slow, fast, the odd zoomies), whether and
 * where it trips, and so who gets there first. Deterministic in the seed.
 */
export function planShow(spec: TreatShowSpec): ShowPlan {
  const rng = mulberry32(spec.seed);
  const at = spec.at;
  const dists = spec.racers.map((r) => Math.hypot(at.x - r.x, at.y - r.y));
  const avg = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
  const newTrip = (): Trip => ({ frac: 0.3 + rng() * 0.4, dur: 0.9 + rng() * 0.5, line: Math.floor(rng() * 2) });
  const runs: Run[] = spec.racers.map((r) => {
    // Most take 1.6-3.2 s over the average distance; one in six gets the zoomies, one in eight dawdles.
    const roll = rng();
    let time = 1.6 + rng() * 1.6;
    if (roll < 1 / 6) time *= 0.62;
    else if (roll > 7 / 8) time *= 1.45;
    const speed = Math.max(3, Math.max(avg, 6) / time);
    const go = RACE_AT + 0.05 + rng() * 0.4;
    const trip = rng() < 0.3 ? newTrip() : undefined;
    return { id: r.id, companion: r.companion, start: { x: r.x, y: r.y }, stop: at, go, speed, trip, arrive: 0 };
  });
  // A race of two or more where nobody trips: maybe someone does anyway (it's funnier).
  if (runs.length > 1 && !runs.some((r) => r.trip) && rng() < 0.45) runs[Math.floor(rng() * runs.length)].trip = newTrip();
  // Who gets there first: the time for each to reach the treat.
  const reach = runs.map((r, i) => r.go + runTime(Math.max(0, dists[i] - WIN_GAP), r.speed, r.trip));
  const order = runs.map((_, i) => i).sort((a, b) => reach[a] - reach[b] || (runs[a].id < runs[b].id ? -1 : 1));
  const winLineIdx = Math.floor(rng() * 3);
  const takenAt = order.length ? reach[order[0]] : LAND_AT + DUD_LINGER;
  // Where each one stops: the winner right at it, the rest in a loose ring, each on its own side, and never
  // before it's taken (a loser that would get to its spot sooner slows down to arrive just after).
  order.forEach((i, rank) => {
    const r = runs[i];
    const d = dists[i] || 1;
    const ux = (r.start.x - at.x) / d;
    const uy = (r.start.y - at.y) / d;
    const k = Math.min(rank === 0 ? WIN_GAP : RING + rank * 0.35, d);
    r.stop = { x: at.x + ux * k, y: at.y + uy * k };
    const dist = Math.max(0, d - k);
    if (rank > 0) {
      const latest = takenAt + 0.15;
      if (dist > 0 && r.go + runTime(dist, r.speed, r.trip) < latest) {
        const trip = r.trip && r.trip.frac * dist + TUMBLE < dist ? r.trip.dur : 0;
        r.speed = Math.max(0.5, (dist - (trip ? TUMBLE : 0)) / Math.max(0.2, latest - r.go - trip));
      }
      if (rng() < 0.6) r.sulk = Math.floor(rng() * LOSER_LINES.length);
    }
    r.arrive = r.go + runTime(dist, r.speed, r.trip);
  });
  const winner = order.length ? runs[order[0]].id : null;
  const homeAt = takenAt + (winner ? BEATS.celebrate : 0.2);
  return { runs, winner, winLine: winLineIdx, takenAt, homeAt, endAt: homeAt + BEATS.home };
}

/** How long a show lasts (ms), for the room's lock. */
export const showMs = (spec: TreatShowSpec): number => Math.ceil(planShow(spec).endAt * 1000);

/** What a racer is doing at time t (s from the purchase). */
export interface RunPose {
  x: number;
  y: number;
  /** Running (bobbing along), lying tripped, or standing. */
  state: "wait" | "run" | "trip" | "stand" | "home";
  /** Direction of travel on the table (unit vector), for leaning into it. */
  dx: number;
  dy: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/** Where a racer is at time t, and what it's doing. */
export function runPose(run: Run, plan: ShowPlan, t: number): RunPose {
  const total = Math.hypot(run.stop.x - run.start.x, run.stop.y - run.start.y);
  const ux = total > 0 ? (run.stop.x - run.start.x) / total : 0;
  const uy = total > 0 ? (run.stop.y - run.start.y) / total : 0;
  const along = (tt: number): { d: number; state: RunPose["state"] } => {
    if (tt <= run.go) return { d: 0, state: "wait" };
    let moving = tt - run.go;
    const trip = run.trip;
    if (trip) {
      const tripAt = (trip.frac * total) / run.speed;
      if (trip.frac * total + TUMBLE < total) {
        if (moving > tripAt && moving <= tripAt + trip.dur) return { d: trip.frac * total + Math.min(TUMBLE, (moving - tripAt) * 3), state: "trip" };
        if (moving > tripAt + trip.dur) moving -= trip.dur - TUMBLE / run.speed;
      }
    }
    const d = moving * run.speed;
    return d >= total ? { d: total, state: "stand" } : { d, state: "run" };
  };
  // Losers who are still on their way when it's taken give up a moment later.
  const giveUp = run.id === plan.winner ? Infinity : plan.takenAt + 0.5;
  const at = (tt: number) => {
    const a = along(Math.min(tt, giveUp, plan.homeAt));
    return { x: run.start.x + ux * a.d, y: run.start.y + uy * a.d, state: tt > giveUp && a.state !== "trip" ? ("stand" as const) : a.state };
  };
  if (t >= plan.homeAt) {
    const from = at(plan.homeAt);
    const u = Math.min(1, (t - plan.homeAt) / BEATS.home);
    const e = easeInOut(u);
    return { x: lerp(from.x, run.start.x, e), y: lerp(from.y, run.start.y, e), state: "home", dx: -ux, dy: -uy };
  }
  const p = at(t);
  return { ...p, dx: ux, dy: uy };
}

// --- where the machine stands, and where a treat lands -------------------------------------------------

/** How much table the machine takes up (radius around its spot). */
export const MACHINE_R = 2.4;

/**
 * Whether a machine fits at table point `p`: on the table (not hanging off its rim) and clear of every mat. The
 * default spots are picked with it, and the room checks a player's move against it too.
 */
export function machineFits(p: Vec2, seatCount: number): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  if (Math.hypot(p.x, p.y) > tableRadius(seatCount) - MACHINE_R - 0.5) return false;
  for (let seat = 0; seat < Math.max(1, seatCount); seat++) {
    const l = tableToLocal(p, seat, seatCount);
    if (Math.abs(l.x) < MAT_W / 2 + MACHINE_R && Math.abs(l.y) < MAT_D / 2 + MACHINE_R) return false;
  }
  return true;
}

/** Out by the rim beside the left end of the mat, level with its middle: the farthest out that fits first. */
const SIDE_SPOTS: Vec2[] = [0, -1, -2, -3, -4, 1, 2].flatMap((y) => [-19, -18.5, -18, -17.5, -17, -16.5].map((x) => ({ x, y })));
/** Past the far left corner of the mat, beyond the exile pile. */
const CORNER_SPOTS: Vec2[] = [
  { x: -8.5, y: -10 },
  { x: -8.5, y: -9 },
];

/**
 * Where the machine stands by default for the player at `seat` (seat-local spots, the first that fits): out by the
 * rim beside the left end of their mat, away from everyone's cards, where their camera still has it in view. Solo,
 * the camera is too close for the rim to be in shot, so it stands past the far left corner of the mat (there's
 * nobody else's mat to crowd). Every player sees their own copy (the cameras frame each mat too tightly for one
 * shared machine to be in everyone's shot), and can move it (TablePlayer.machineAt), so only where a treat flies
 * *from* differs between screens.
 */
export function machineSpot(seat: number, seatCount: number): Vec2 {
  const spots = seatCount <= 1 ? [...CORNER_SPOTS, ...SIDE_SPOTS] : [...SIDE_SPOTS, ...CORNER_SPOTS];
  for (const l of spots) {
    const p = localToTable(l, seat, seatCount);
    if (machineFits(p, seatCount)) return p;
  }
  return localToTable({ x: -17, y: 0 }, seat, seatCount);
}

/** Where a player's machine stands: where they put it, or else its default spot by their mat. */
export const machineAt = (stored: Vec2 | undefined, seat: number, seatCount: number): Vec2 => stored ?? machineSpot(seat, seatCount);

/** How far in from the table's rim a treat lands (it's ~2.6 across, and the companions crowd round it). */
export const LANDING_RIM = 2;
/** How far a treat lands from any machine. */
export const LANDING_CLEAR = MACHINE_R + 1.6;

/**
 * A random spot anywhere on the table, mats and cards included (the treat sits on top, and the companions run
 * over them), short of the rim and clear of every machine (`machines`: each seat's, where its player has it).
 * Falls back to the centre.
 */
export function pickLanding(seatCount: number, rng: Rng, machines: Vec2[]): Vec2 {
  const R = tableRadius(seatCount) - LANDING_RIM;
  for (let i = 0; i < 80; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * R;
    const p = { x: Math.round(Math.cos(a) * r * 100) / 100, y: Math.round(Math.sin(a) * r * 100) / 100 };
    if (machines.every((m) => Math.hypot(m.x - p.x, m.y - p.y) > LANDING_CLEAR)) return p;
  }
  return { x: 0, y: 0 };
}

/** When a run trips (s from the purchase), or null if it doesn't (or would only trip at the very end). */
export function tripTime(run: Run): number | null {
  const total = Math.hypot(run.stop.x - run.start.x, run.stop.y - run.start.y);
  if (!run.trip || !(run.trip.frac * total + TUMBLE < total)) return null;
  return run.go + (run.trip.frac * total) / run.speed;
}
