// How a companion moves when it reacts (a poke, an emote, being picked up): a handful of motion primitives
// applied to its one picture, composed per reaction from data (companionReactions.ts), scaled by the
// companion's body style. Pure, so it can be tested; the three.js wiring is in CompanionFigure.tsx.
//
// A companion is a THREE.Sprite, which always faces the camera: a pose can only slide it on screen, scale it,
// roll it in the picture's plane (about its feet) and fade it. No flips, so "turning round" is a squeeze.

/**
 * Where the picture is, relative to standing still. Offsets are in body heights along the screen's right and
 * up; scales are factors; `rot` is a counter-clockwise roll in radians about the feet; `alpha` is opacity.
 */
export interface Pose {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
  alpha: number;
}

export const REST: Pose = Object.freeze({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1 });

/** How a companion's body moves, the same for all its reactions: what makes a slime read differently from a dice. */
export interface BodyStyle {
  /** Height of its jumps (1 = average). */
  bounce: number;
  /** Tempo: above 1 everything plays faster (reactions get shorter). */
  speed: number;
  /** How far it leans, sways and shakes. */
  amp: number;
  /** How much it squashes and stretches: jelly above 1, stone below. */
  squash: number;
  /** Its middle, as a fraction of its height: spins turn about this point rather than the feet. */
  pivot: number;
  /** Where effect glyphs appear above its feet, as a fraction of its height. */
  head: number;
}

export const DEFAULT_STYLE: BodyStyle = Object.freeze({ bounce: 1, speed: 1, amp: 1, squash: 1, pivot: 0.42, head: 0.82 });

export const PRIMITIVES = [
  "hop",
  "boing",
  "rock",
  "shake",
  "spin",
  "puff",
  "flatten",
  "droop",
  "nod",
  "lean",
  "wiggle",
  "float",
  "faint",
  "vibrate",
  "duck",
  "turn",
  "flicker",
  "slide",
  "circle",
] as const;
export type PrimId = (typeof PRIMITIVES)[number];

/** One motion in a reaction: a primitive played from `at` for `dur` seconds (authored at speed 1). */
export interface Motion {
  prim: PrimId;
  at: number;
  dur: number;
  /** Repetitions (hops, shakes, sways...); each primitive has its own default. */
  n?: number;
  /** Strength, 1 = the primitive's normal size. */
  a?: number;
  /** Which way it leans/spins/slides: 1 = left (counter-clockwise), -1 = right. */
  dir?: 1 | -1;
}

export const GLYPHS = ["heart", "sparkle", "sweat", "anger", "zzz", "note", "star", "smoke", "bang", "question", "tear", "flame", "leaf", "bubble"] as const;
export type GlyphId = (typeof GLYPHS)[number];

/** How a glyph moves over its life. `still` is the reduced-motion stand-in: it only fades in and out. */
export const GLYPH_MOTIONS = ["rise", "pop", "burst", "orbit", "drip", "puff", "fall", "still"] as const;
export type GlyphMotion = (typeof GLYPH_MOTIONS)[number];

/** An effect glyph a reaction shows: `n` copies (staggered), from `at` seconds (authored at speed 1). */
export interface Fx {
  glyph: GlyphId;
  motion: GlyphMotion;
  at: number;
  /** Life of each copy in seconds (authored at speed 1). */
  dur?: number;
  n?: number;
  /** Where it starts, in body heights from the head (x to the screen's right). */
  x?: number;
  y?: number;
  size?: number;
  /** Multiplies the glyph's own colours (white = as drawn). */
  tint?: string;
}

/** A reaction: motions and glyphs on a timeline. Non-loops start and end at rest; loops repeat every `duration`. */
export interface Reaction {
  /** Seconds, authored at speed 1 (a companion's style.speed shortens or lengthens it). */
  duration: number;
  loop?: boolean;
  motions: readonly Motion[];
  fx: readonly Fx[];
  /** The companion's signature move this reaction is drawn from, when it's one of theirs (shown in the lab). */
  move?: string;
}

/** Seconds between staggered copies of a glyph, and a glyph's default life. */
export const FX_STAGGER = 0.12;
export const FX_LIFE = 1;
/** How long a new reaction (or a stop) takes to take over from whatever pose came before: no pops. */
export const BLEND_MS = 80;

// --- shapes ---------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0, softly. */
const bell = (u: number) => Math.sin(Math.PI * clamp01(u));
/** 0, up quickly, hold, down again by the end. */
const hold = (u: number, inn = 0.2, out = 0.25) => smooth(u / inn) * (1 - smooth((u - (1 - out)) / out));
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const reps = (n: number | undefined, d: number) => Math.max(1, Math.round(n ?? d));
/** An angle folded into (-π, π], so a spin that has come all the way round reads as no roll at all. */
export const wrapAngle = (a: number) => {
  const w = ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return Math.abs(w) < 1e-9 ? 0 : w;
};

/**
 * Rolling about the feet would push one side of the body into the floor (and the table would hide it), so
 * whatever tips over is lifted onto its "corner": half a body's footprint times how far it has tipped.
 */
const tip = (rot: number) => 0.25 * Math.abs(Math.sin(rot));

type Delta = Partial<Pose>;
type Prim = (u: number, a: number, n: number | undefined, dir: number, style: BodyStyle) => Delta;

/** Each primitive is at rest at u = 0 and u = 1 (whatever its n), so motions can be laid end to end. */
const PRIMS: Record<PrimId, Prim> = {
  // Jumps; stretched in the air.
  hop: (u, a, n) => {
    const h = Math.abs(Math.sin(Math.PI * reps(n, 1) * u));
    return { dy: 0.22 * a * h, sy: 1 + 0.06 * a * h, sx: 1 - 0.04 * a * h };
  },
  // Squash and stretch that rings out.
  boing: (u, a, n) => {
    const s = -Math.sin(TAU * (n ?? 1.5) * u) * (1 - u) * bell(u);
    return { sy: 1 + 0.2 * a * s, sx: 1 - 0.13 * a * s };
  },
  // Sways side to side about its feet.
  rock: (u, a, n, dir) => {
    const rot = dir * 0.2 * a * Math.sin(TAU * (n ?? 1) * u) * bell(u);
    return { rot, dy: tip(rot) };
  },
  // Quick side-to-side shudder.
  shake: (u, a, n) => ({ dx: 0.05 * a * Math.sin(TAU * (n ?? 4) * u) * bell(u) }),
  // Whole turns in the picture's plane, about its middle (the feet are moved to keep the middle still).
  spin: (u, _a, n, dir, style) => {
    const rot = wrapAngle(dir * TAU * reps(n, 1) * easeInOut(clamp01(u)));
    const p = style.pivot;
    return { rot, dx: p * Math.sin(rot), dy: p - p * Math.cos(rot) };
  },
  // Swells up for a moment.
  puff: (u, a) => {
    const k = smooth(u / 0.35) * (1 - smooth((u - 0.35) / 0.65));
    return { sx: 1 + 0.18 * a * k, sy: 1 + 0.2 * a * k };
  },
  // Squashed flat (a landing, a sulky loaf).
  flatten: (u, a) => {
    const k = hold(u, 0.15, 0.3);
    return { sy: 1 - 0.42 * a * k, sx: 1 + 0.28 * a * k };
  },
  // Sags: shorter, a little lower, head tipped.
  droop: (u, a, _n, dir) => {
    const k = hold(u, 0.3, 0.3);
    const rot = dir * 0.1 * a * k;
    return { sy: 1 - 0.12 * a * k, sx: 1 + 0.04 * a * k, dy: -0.03 * a * k + tip(rot), rot };
  },
  // Nods (a dip and a little tip).
  nod: (u, a, n, dir) => {
    const k = Math.abs(Math.sin(Math.PI * reps(n, 1) * u));
    return { dy: -0.04 * a * k, sy: 1 - 0.05 * a * k, rot: dir * 0.07 * a * k };
  },
  // Leans over and holds it.
  lean: (u, a, _n, dir) => {
    const rot = dir * 0.28 * a * hold(u, 0.2, 0.25);
    return { rot, dy: tip(rot) };
  },
  // Happy wiggle: quick sways with a shimmy of width.
  wiggle: (u, a, n) => {
    const e = bell(u);
    const rot = 0.13 * a * Math.sin(TAU * (n ?? 3) * u) * e;
    return { rot, dy: tip(rot), sx: 1 + 0.04 * a * Math.sin(TAU * 2 * (n ?? 3) * u) * e };
  },
  // Rises off the ground and bobs.
  float: (u, a, n) => {
    const e = bell(u);
    return { dy: a * (0.12 * e + 0.025 * Math.sin(TAU * (n ?? 1) * u) * e) };
  },
  // Keels over onto its side, lies there, gets back up.
  faint: (u, a, _n, dir) => {
    const k = hold(u, 0.18, 0.22);
    const rot = dir * 1.3 * a * k;
    return { rot, dy: tip(rot), sy: 1 - 0.08 * a * Math.sin(Math.PI * clamp01(u / 0.36)) };
  },
  // A fast buzz in place (excited, or seething).
  vibrate: (u, a, n) => {
    const k = hold(u, 0.1, 0.2);
    const f = n ?? 14;
    return { dx: 0.016 * a * Math.sin(TAU * f * u) * k, dy: 0.01 * a * Math.sin(TAU * f * 1.37 * u) * k };
  },
  // Ducks down low (hiding).
  duck: (u, a) => {
    const k = hold(u, 0.15, 0.3);
    return { sy: 1 - 0.38 * a * k, sx: 1 + 0.06 * a * k, dy: -0.06 * a * k };
  },
  // "Turns round": squeezed edge-on and back (a page flip, a twirl), since a sprite can't flip.
  turn: (u, _a, n) => ({ sx: 1 - 0.9 * Math.abs(Math.sin(Math.PI * reps(n, 1) * u)) }),
  // Dims and brightens (a nervous candle, blowing out).
  flicker: (u, a, n) => ({ alpha: 1 - Math.min(0.85, 0.55 * a) * hold(u, 0.1, 0.25) * (0.5 + 0.5 * Math.sin(TAU * (n ?? 5) * u)) }),
  // Scoots sideways and back.
  slide: (u, a, _n, dir) => ({ dx: -dir * 0.22 * a * bell(u) }),
  // Drifts round in a little loop.
  circle: (u, a, n, dir) => {
    const w = TAU * (n ?? 1) * u;
    const e = bell(u) ** 0.5;
    return { dx: -dir * 0.18 * a * Math.sin(w) * e, dy: 0.07 * a * (1 - Math.cos(w)) * e };
  },
};

/** Primitives the body style leaves alone: a spin is whole turns, a turn is a squeeze to edge-on. */
const UNSTYLED: ReadonlySet<PrimId> = new Set(["spin", "turn", "flicker"]);
/** Primitives whose height is a jump, scaled by bounce rather than amp. */
const JUMPS: ReadonlySet<PrimId> = new Set(["hop", "float"]);

/** One primitive at progress u (0..1), with the body style applied. Outside 0..1 it is at rest. */
export function primitivePose(m: Pick<Motion, "prim" | "n" | "a" | "dir">, u: number, style: BodyStyle = DEFAULT_STYLE): Pose {
  if (!(u > 0 && u < 1)) return { ...REST };
  const d = PRIMS[m.prim](u, m.a ?? 1, m.n, m.dir ?? 1, style);
  const raw: Pose = { ...REST, ...d };
  if (UNSTYLED.has(m.prim)) return raw;
  const lift = JUMPS.has(m.prim) ? style.bounce : style.amp;
  return {
    dx: raw.dx * style.amp,
    dy: raw.dy * lift,
    sx: Math.max(0.05, 1 + (raw.sx - 1) * style.squash),
    sy: Math.max(0.05, 1 + (raw.sy - 1) * style.squash),
    rot: raw.rot * style.amp,
    alpha: raw.alpha,
  };
}

/** Layers b on top of a: offsets and rolls add, scales and opacity multiply. */
export function compose(a: Pose, b: Pose): Pose {
  return { dx: a.dx + b.dx, dy: a.dy + b.dy, sx: a.sx * b.sx, sy: a.sy * b.sy, rot: a.rot + b.rot, alpha: a.alpha * b.alpha };
}

/** k of the way from a to b (straight: advanceTrack sees to it that the rolls are close). */
export function blendPose(a: Pose, b: Pose, k: number): Pose {
  const t = clamp01(k);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return { dx: mix(a.dx, b.dx), dy: mix(a.dy, b.dy), sx: mix(a.sx, b.sx), sy: mix(a.sy, b.sy), rot: mix(a.rot, b.rot), alpha: mix(a.alpha, b.alpha) };
}

/** How far a blend that started `ms` ago has got (eased; 1 = done). */
export const blendWeight = (ms: number): number => smooth(ms / BLEND_MS);

/** A figure's reaction layer: which play it is showing, the pose it blends out of, and how far its glyphs have got. */
export interface Track {
  seq: number;
  from: Pose;
  blendAt: number;
  last: Pose;
  /** Seconds into the reaction that glyphs have been spawned up to. */
  fxUpTo: number;
  /** The target's roll, kept continuous (a spin's roll wraps at half a turn; this one keeps counting). */
  aim: number;
}
export const newTrack = (): Track => ({ seq: 0, from: REST, blendAt: -Infinity, last: REST, fxUpTo: 0, aim: 0 });

/**
 * The reaction layer's pose at `now` (ms): `reaction` (undefined = none, or stopped) is `since` seconds in. A new
 * play (a different `seq`) starts from wherever the last one had got to and blends over BLEND_MS: no pops.
 */
export function advanceTrack(tr: Track, seq: number, reaction: Reaction | undefined, since: number, style: BodyStyle, now: number): Pose {
  const fresh = seq !== tr.seq;
  if (fresh) {
    tr.seq = seq;
    tr.from = tr.last;
    tr.blendAt = now;
    tr.fxUpTo = -1;
  }
  const target = reaction ? samplePose(reaction, style, since) : REST;
  // The roll is unwrapped frame to frame, and a new play starts on the turn nearest the old pose: blending
  // straight toward it then never swings the long way round, even when the target crosses a half turn.
  const base = fresh ? tr.from.rot : tr.aim;
  tr.aim = base + wrapAngle(target.rot - base);
  const aimed = { ...target, rot: tr.aim };
  const k = blendWeight(now - tr.blendAt);
  tr.last = k < 1 ? blendPose(tr.from, aimed, k) : aimed;
  return tr.last;
}

/** A reaction's length in seconds for a companion with this style. */
export const reactionSeconds = (r: Reaction, style: BodyStyle = DEFAULT_STYLE): number => r.duration / style.speed;

/** The pose `t` seconds into a reaction. Non-loops are at rest before 0 and from their end on. */
export function samplePose(r: Reaction, style: BodyStyle, t: number): Pose {
  let tau = t * style.speed;
  if (r.loop) tau = ((tau % r.duration) + r.duration) % r.duration;
  else if (!(tau > 0 && tau < r.duration)) return { ...REST };
  let pose: Pose = { ...REST };
  for (const m of r.motions) {
    const u = (tau - m.at) / m.dur;
    if (u > 0 && u < 1) pose = compose(pose, primitivePose(m, u, style));
  }
  return pose;
}

/** A glyph copy due to appear: which fx entry, which copy of it, when (seconds into the reaction) and for how long (seconds). */
export interface FxSpawn {
  index: number;
  copy: number;
  t: number;
  life: number;
}

/**
 * The glyphs that appear between `from` (exclusive) and `to` (inclusive) seconds into a reaction, in order, leaving
 * out any that would already be over by `to`: after a long gap (a hidden tab) only the ones still showing come back,
 * part-way through their lives. Loops repeat theirs every period.
 */
export function fxSpawns(r: Reaction, style: BodyStyle, from: number, to: number): FxSpawn[] {
  const out: FxSpawn[] = [];
  const period = reactionSeconds(r, style);
  const first = r.loop ? Math.max(Math.floor(from / period), Math.floor(to / period) - 1) : 0;
  const last = r.loop ? Math.floor(to / period) : 0;
  for (let k = first; k <= last; k++) {
    r.fx.forEach((fx, index) => {
      for (let copy = 0; copy < Math.max(1, fx.n ?? 1); copy++) {
        const t = k * period + (fx.at + copy * FX_STAGGER) / style.speed;
        const life = (fx.dur ?? FX_LIFE) / style.speed;
        if (t > from && t <= to && t + life > to) out.push({ index, copy, t, life });
      }
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Where a glyph is, relative to where it appeared (body heights), and how big and visible it is. */
export interface GlyphPose {
  x: number;
  y: number;
  scale: number;
  alpha: number;
  rot: number;
}

/** A glyph `u` (0..1) of the way through its life; `copy` of `count` spreads the copies of one fx entry apart. */
export function glyphPose(motion: GlyphMotion, u: number, copy = 0, count = 1): GlyphPose {
  const t = clamp01(u);
  const spread = count > 1 ? copy / (count - 1) - 0.5 : 0; // -0.5 .. 0.5
  const popIn = Math.min(1, t / 0.15) ** 0.5 * (1 + 0.25 * bell(Math.min(1, t / 0.3)));
  const fadeOut = 1 - smooth((t - 0.6) / 0.4);
  switch (motion) {
    case "rise":
      return { x: spread * 0.36 + 0.05 * Math.sin(TAU * 1.2 * t + copy), y: 0.4 * t, scale: popIn, alpha: fadeOut, rot: 0.15 * Math.sin(TAU * t + copy) };
    case "pop":
      return { x: spread * 0.3, y: 0.04 * t, scale: popIn, alpha: 1 - smooth((t - 0.75) / 0.25), rot: 0 };
    case "burst": {
      const ang = Math.PI / 2 + spread * Math.PI * 0.9 + (count > 1 ? 0 : 0.5);
      const r = 0.48 * (1 - (1 - t) ** 3);
      return { x: Math.cos(ang) * r, y: Math.sin(ang) * r * 0.8, scale: popIn * (1 - 0.3 * t), alpha: fadeOut, rot: spread * 0.6 };
    }
    case "orbit": {
      const ang = TAU * (1.3 * t + copy / Math.max(1, count));
      return { x: 0.26 * Math.cos(ang), y: 0.12 + 0.06 * Math.sin(ang), scale: 0.8 * popIn, alpha: fadeOut, rot: TAU * t };
    }
    case "drip":
      return { x: 0.22 + spread * 0.3, y: -0.3 * t * t, scale: popIn, alpha: fadeOut, rot: 0 };
    case "puff":
      return { x: spread * 0.4, y: 0.12 * t, scale: 0.6 + 1.1 * (1 - (1 - t) ** 2), alpha: 0.9 * (1 - t) ** 1.5 * Math.min(1, t / 0.08), rot: 0.4 * t };
    case "fall":
      return { x: spread * 0.5, y: 0.35 - 0.6 * t, scale: Math.min(1, t / 0.1), alpha: fadeOut, rot: 0 };
    case "still":
      return { x: 0, y: 0.12, scale: 1, alpha: Math.min(1, t / 0.15) * (1 - smooth((t - 0.75) / 0.25)), rot: 0 };
  }
}
