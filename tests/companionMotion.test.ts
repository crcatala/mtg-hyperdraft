import { describe, expect, it } from "vitest";
import {
  advanceTrack,
  blendPose,
  blendWeight,
  BLEND_MS,
  compose,
  DEFAULT_STYLE,
  fxSpawns,
  GLYPH_MOTIONS,
  GLYPHS,
  glyphPose,
  newTrack,
  primitivePose,
  PRIMITIVES,
  reactionSeconds,
  REST,
  samplePose,
  wrapAngle,
  type BodyStyle,
  type Pose,
  type Reaction,
} from "../src/client/table/companionMotion";
import { BODY_STYLES, bodyStyle, DEFAULT_REACTIONS, reactionFor, SIGNATURES, signatureSlots } from "../src/client/table/companionReactions";
import { COMPANION_IDS } from "../src/shared/roster";
import { REACTION_IDS } from "../src/shared/companionKit";

const KEYS = ["dx", "dy", "sx", "sy", "rot", "alpha"] as const;
const finite = (p: Pose) => KEYS.every((k) => Number.isFinite(p[k]));
const near = (a: Pose, b: Pose, eps = 1e-6) => KEYS.every((k) => Math.abs(a[k] - b[k]) <= eps);
/** The pose's distance from standing still (a roll counts as it looks: a full turn is no roll). */
const offRest = (p: Pose) => Math.max(Math.abs(p.dx), Math.abs(p.dy), Math.abs(p.sx - 1), Math.abs(p.sy - 1), Math.abs(wrapAngle(p.rot)), Math.abs(p.alpha - 1));
const STYLES: BodyStyle[] = [DEFAULT_STYLE, ...Object.values(BODY_STYLES)];
const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

describe("motion primitives", () => {
  for (const prim of PRIMITIVES) {
    it(`${prim}: at rest at both ends, finite and sane in between, for any reps/strength/direction`, () => {
      for (const style of STYLES)
        for (const n of [undefined, 0.5, 1, 2.5, 4])
          for (const a of [0.3, 1, 2])
            for (const dir of [1, -1] as const) {
              const m = { prim, n, a, dir };
              expect(offRest(primitivePose(m, 0, style))).toBeLessThan(1e-6);
              expect(offRest(primitivePose(m, 1, style))).toBeLessThan(1e-6);
              // Just inside the ends it's still (almost) at rest: no pop as a motion starts or stops.
              expect(offRest(primitivePose(m, 0.001, style))).toBeLessThan(0.05);
              expect(offRest(primitivePose(m, 0.999, style))).toBeLessThan(0.05);
              for (const u of steps(50)) {
                const p = primitivePose(m, u, style);
                expect(finite(p)).toBe(true);
                expect(p.sx).toBeGreaterThan(0);
                expect(p.sy).toBeGreaterThan(0);
                expect(p.alpha).toBeGreaterThanOrEqual(0);
                expect(p.alpha).toBeLessThanOrEqual(1);
                expect(Math.abs(p.dx) + Math.abs(p.dy)).toBeLessThan(2);
              }
            }
    });
  }

  it("moves at all (every primitive changes the pose mid-way)", () => {
    for (const prim of PRIMITIVES) expect(Math.max(...steps(20).map((u) => offRest(primitivePose({ prim }, u))))).toBeGreaterThan(0.01);
  });

  it("is rest outside its time span and deterministic", () => {
    expect(primitivePose({ prim: "hop" }, -0.5)).toEqual(REST);
    expect(primitivePose({ prim: "hop" }, 1.5)).toEqual(REST);
    expect(primitivePose({ prim: "wiggle", n: 3 }, 0.37)).toEqual(primitivePose({ prim: "wiggle", n: 3 }, 0.37));
  });

  it("scales with the body style: bouncier jumps, squashier squashes, but spins stay whole turns", () => {
    const at = (prim: (typeof PRIMITIVES)[number], style: BodyStyle) => primitivePose({ prim }, 0.5, style);
    expect(at("hop", { ...DEFAULT_STYLE, bounce: 2 }).dy).toBeCloseTo(at("hop", DEFAULT_STYLE).dy * 2);
    expect(at("flatten", { ...DEFAULT_STYLE, squash: 2 }).sy - 1).toBeCloseTo((at("flatten", DEFAULT_STYLE).sy - 1) * 2);
    expect(at("lean", { ...DEFAULT_STYLE, amp: 0.5 }).rot).toBeCloseTo(at("lean", DEFAULT_STYLE).rot * 0.5);
    expect(at("spin", { ...DEFAULT_STYLE, amp: 3 })).toEqual(at("spin", DEFAULT_STYLE));
  });

  it("spins about the body's middle, not its feet", () => {
    // Half way through one turn the picture is upside down: the feet sit two pivots above where they were.
    const p = primitivePose({ prim: "spin" }, 0.5);
    expect(Math.abs(p.rot)).toBeCloseTo(Math.PI);
    expect(p.dy).toBeCloseTo(2 * DEFAULT_STYLE.pivot);
    expect(p.dx).toBeCloseTo(0);
  });
});

describe("pose maths", () => {
  const a: Pose = { dx: 0.1, dy: 0.2, sx: 1.2, sy: 0.8, rot: 0.3, alpha: 0.5 };
  it("composes offsets/rolls additively and scales/opacity multiplicatively; rest is neutral", () => {
    expect(compose(REST, a)).toEqual(a);
    expect(compose(a, REST)).toEqual(a);
    const c = compose(a, a);
    expect(c.dx).toBeCloseTo(0.2);
    expect(c.sx).toBeCloseTo(1.44);
    expect(c.alpha).toBeCloseTo(0.25);
  });
  it("blends between poses and eases the blend in over BLEND_MS", () => {
    expect(blendPose(a, REST, 0)).toEqual(a);
    expect(near(blendPose(a, REST, 1), REST)).toBe(true);
    expect(blendPose(a, REST, 0.5).dx).toBeCloseTo(0.05);
    // Rolls blend the short way: from just under a full turn to none is a small nudge, not a spin back.
    expect(blendPose({ ...REST, rot: 6.2 }, REST, 0.5).rot).toBeGreaterThan(6.2);
    expect(blendWeight(0)).toBe(0);
    expect(blendWeight(BLEND_MS / 2)).toBeCloseTo(0.5);
    expect(blendWeight(BLEND_MS)).toBe(1);
    expect(blendWeight(Infinity)).toBe(1);
  });
  it("folds angles so a full turn is no turn", () => {
    expect(wrapAngle(Math.PI * 2)).toBe(0);
    expect(wrapAngle(-Math.PI * 4)).toBe(0);
    expect(wrapAngle(Math.PI / 2 + Math.PI * 2)).toBeCloseTo(Math.PI / 2);
  });
});

describe("glyphs", () => {
  it("every glyph motion is finite, fades out by the end of its life and spreads its copies apart", () => {
    for (const motion of GLYPH_MOTIONS)
      for (const count of [1, 3, 5])
        for (let copy = 0; copy < count; copy++) {
          for (const u of steps(40)) {
            const g = glyphPose(motion, u, copy, count);
            expect([g.x, g.y, g.scale, g.alpha, g.rot].every(Number.isFinite)).toBe(true);
            expect(g.alpha).toBeGreaterThanOrEqual(0);
            expect(g.alpha).toBeLessThanOrEqual(1);
          }
          expect(glyphPose(motion, 1, copy, count).alpha).toBeLessThan(0.01);
        }
    for (const motion of ["rise", "burst", "fall"] as const) expect(glyphPose(motion, 0.5, 0, 3).x).not.toBeCloseTo(glyphPose(motion, 0.5, 2, 3).x);
  });
  it("the reduced-motion glyph stays put", () => {
    for (const u of steps(10)) expect(glyphPose("still", u)).toMatchObject({ x: 0, y: 0.12, scale: 1, rot: 0 });
  });
});

describe("glyph spawning", () => {
  const r: Reaction = { duration: 1, motions: [], fx: [{ glyph: "heart", motion: "rise", at: 0.2, n: 3 }, { glyph: "bang", motion: "pop", at: 0 }] };
  it("spawns each copy once, staggered, in time order, however the frames fall", () => {
    const all = fxSpawns(r, DEFAULT_STYLE, -1, 10);
    expect(all.map((s) => [s.index, s.copy])).toEqual([[1, 0], [0, 0], [0, 1], [0, 2]]);
    let from = -1;
    const stepped = [];
    for (let t = 0; t <= 1.2; t += 1 / 60) {
      stepped.push(...fxSpawns(r, DEFAULT_STYLE, from, t));
      from = t;
    }
    expect(stepped.map((s) => [s.index, s.copy])).toEqual(all.map((s) => [s.index, s.copy]));
  });
  it("plays faster for a faster companion, and repeats a loop's glyphs every period", () => {
    expect(fxSpawns(r, { ...DEFAULT_STYLE, speed: 2 }, -1, 10).find((s) => s.index === 0)!.t).toBeCloseTo(0.1);
    const loop = { ...r, loop: true };
    expect(fxSpawns(loop, DEFAULT_STYLE, 0.5, 1.5).map((s) => [s.index, s.t])).toEqual([[1, 1], [0, 1.2], [0, 1.32], [0, 1.44]]);
    // A hidden tab coming back only catches up on the latest period, not hundreds.
    expect(fxSpawns(loop, DEFAULT_STYLE, 0, 1000.5).length).toBeLessThanOrEqual(8);
  });
});

describe("the 180 reactions (18 slots × 10 companions)", () => {
  it("the shared table covers exactly the kit's reaction slots", () => {
    expect(Object.keys(DEFAULT_REACTIONS).sort()).toEqual([...REACTION_IDS].sort());
    expect(REACTION_IDS).toHaveLength(18);
  });

  it("every companion has a body style and only overrides real slots", () => {
    expect(Object.keys(BODY_STYLES).sort()).toEqual([...COMPANION_IDS].sort());
    expect(Object.keys(SIGNATURES).sort()).toEqual([...COMPANION_IDS].sort());
    for (const id of COMPANION_IDS) for (const slot of signatureSlots(id)) expect(REACTION_IDS).toContain(slot);
    expect(reactionFor("hex", "nope")).toBeUndefined();
    expect(reactionFor("nobody", "poke1")).toBe(DEFAULT_REACTIONS.poke1);
    expect(bodyStyle("nobody")).toBe(DEFAULT_STYLE);
  });

  it("every companion has at least 4 signature moves, including its finale, drop or two emotes, each named after a move", () => {
    for (const id of COMPANION_IDS) {
      const sigs = signatureSlots(id);
      expect(sigs.length, id).toBeGreaterThanOrEqual(4);
      expect(sigs, id).toContain("poke7");
      expect(sigs.filter((s) => s.startsWith("emote")).length, id).toBeGreaterThanOrEqual(2);
      for (const slot of sigs) expect(SIGNATURES[id][slot].move, `${id} ${slot}`).toBeTruthy();
    }
  });

  for (const id of COMPANION_IDS) {
    it(`${id}: every reaction is finite, deterministic, short, and starts and ends at rest`, () => {
      const style = bodyStyle(id);
      for (const slot of REACTION_IDS) {
        const r = reactionFor(id, slot)!;
        const where = `${id} ${slot}`;
        const len = reactionSeconds(r, style);
        expect(len, where).toBeGreaterThan(0.3);
        expect(len, where).toBeLessThanOrEqual(3);
        // Every motion fits inside the reaction, so it really is over (at rest) when it ends.
        for (const m of r.motions) {
          expect(m.at, where).toBeGreaterThanOrEqual(0);
          expect(m.at + m.dur, where).toBeLessThanOrEqual(r.duration + 1e-9);
        }
        for (const fx of r.fx) {
          expect(GLYPHS, where).toContain(fx.glyph);
          expect(fx.at, where).toBeLessThan(r.duration);
          expect((fx.dur ?? 1) / style.speed, where).toBeLessThanOrEqual(2);
        }
        for (const u of steps(120)) {
          const p = samplePose(r, style, u * len);
          expect(finite(p), `${where} @${u}`).toBe(true);
          expect(p.sx, where).toBeGreaterThan(0);
          expect(p.sy, where).toBeGreaterThan(0);
          expect(samplePose(r, style, u * len), where).toEqual(p);
        }
        if (r.loop) {
          // A loop comes round seamlessly.
          expect(near(samplePose(r, style, 0), samplePose(r, style, len - 1e-9), 1e-3), where).toBe(true);
        } else {
          expect(offRest(samplePose(r, style, 0)), where).toBeLessThan(1e-6);
          expect(offRest(samplePose(r, style, len)), where).toBeLessThan(1e-6);
          expect(offRest(samplePose(r, style, 0.01)), where).toBeLessThan(0.12);
          expect(offRest(samplePose(r, style, len - 0.01)), where).toBeLessThan(0.12);
        }
      }
    });
  }

  it("companions' finales look different from each other", () => {
    const trace = (id: string) => {
      const r = reactionFor(id, "poke7")!;
      const len = reactionSeconds(r, bodyStyle(id));
      return steps(30).map((u) => samplePose(r, bodyStyle(id), u * len));
    };
    for (let i = 0; i < COMPANION_IDS.length; i++)
      for (let j = i + 1; j < COMPANION_IDS.length; j++) {
        const a = trace(COMPANION_IDS[i]);
        const b = trace(COMPANION_IDS[j]);
        const diff = Math.max(...a.map((p, k) => offRest(compose(p, { ...REST, dx: -b[k].dx, dy: -b[k].dy, rot: -b[k].rot, sx: 1 / b[k].sx, sy: 1 / b[k].sy, alpha: 1 }))));
        expect(diff, `${COMPANION_IDS[i]} vs ${COMPANION_IDS[j]}`).toBeGreaterThan(0.05);
      }
  });
});

describe("interrupting a reaction (the figure's track)", () => {
  /** Frame-by-frame at 60 fps: plays `first`, then `second` (or a stop, "") at `cut` seconds; returns every frame's pose and the cut frame. */
  const run = (id: string, first: string, second: string, cut: number) => {
    const style = bodyStyle(id);
    const tr = newTrack();
    const poses: Pose[] = [];
    let cutAt = -1;
    for (let f = 0; f <= 150; f++) {
      const now = f * (1000 / 60);
      const late = now / 1000 >= cut;
      if (late && cutAt < 0) cutAt = f;
      const [seq, slot, since] = late ? [2, second, now / 1000 - cut] : [1, first, now / 1000];
      poses.push(advanceTrack(tr, seq, slot ? reactionFor(id, slot) : undefined, since, style, now));
    }
    return { poses, cutAt };
  };

  /** The biggest change between two frames; a roll counts at half weight (a spin legitimately turns ~0.4 rad a frame). */
  const step = (p: Pose, q: Pose) => Math.max(...KEYS.map((k) => (k === "rot" ? Math.abs(wrapAngle(p.rot - q.rot)) / 2 : Math.abs(p[k] - q[k]))));

  it("picks up exactly where the old one was, then reaches the new one within BLEND_MS", () => {
    for (const id of COMPANION_IDS)
      for (const [a, b] of [["poke7", "poke3"], ["emote4", "pickup"], ["carry", "drop"], ["carry", ""]] as const)
        for (const cut of [0.2, 0.45, 0.7]) {
          const { poses, cutAt } = run(id, a, b, cut);
          const where = `${id} ${a}→${b || "stop"} @${cut}`;
          // The cut frame shows where the old reaction had got to (the blend starts at weight 0): no jump.
          expect(near(poses[cutAt], poses[cutAt - 1], 1e-9), where).toBe(true);
          // A frame later it has only begun to move toward the new reaction (a ~11% step), not snapped to it.
          expect(step(poses[cutAt], poses[cutAt + 1]), where).toBeLessThan(0.2);
        }
  });

  it("a stopped carry settles back to rest", () => {
    const { poses } = run("gloop", "carry", "", 0.5);
    expect(near(poses[poses.length - 1], REST)).toBe(true);
  });
});
