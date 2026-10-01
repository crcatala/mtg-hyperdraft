// The shape of a foil booster pack, as pure math (no three.js) so it can be unit tested.
//
// A real booster is a flattened tube: a crimped (heat-sealed, ridged) seal at the top and bottom,
// sides that pinch shut, and a body that puffs out like a pillow where the cards sit. Opening it
// means tearing the top seal off along a line just under the crimp. The strip stays attached at the
// tear front and peels away behind it.
//
// Coordinates: x across (-HALF_W … HALF_W), y up, z toward the viewer. The front face bulges to +z
// and the back to -z.

export const PACK_W = 2.6;
export const PACK_H = 4.2;
export const HALF_W = PACK_W / 2;
export const HALF_H = PACK_H / 2;
/** Height of each crimped seal. */
export const CRIMP_H = 0.34;
/** How far the front (and back) bulges from the middle plane at the fullest part of the body. */
export const PACK_T = 0.27;
/** The top strip is torn off along y = TEAR_Y (a little under the top crimp). */
export const TEAR_Y = HALF_H - 0.52;
/** How far in from each crimp the body takes to reach full thickness. */
const TAPER = 0.62;

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** How full the body is at x: 1 through the middle, rounding off to 0 at the pinched sides. */
export function sideProfile(x: number): number {
  const sx = Math.abs(x) / HALF_W;
  return Math.sqrt(Math.max(0, 1 - sx ** 5));
}

/** Half-thickness of the pack at (x, y): 0 along the sides and through the crimped seals. */
export function halfThickness(x: number, y: number): number {
  const fromEnd = HALF_H - CRIMP_H - Math.abs(y);
  const end = smoothstep(0, TAPER, fromEnd);
  // The cards sit a little higher than centre, so the pillow is fullest there.
  const belly = 1 + 0.1 * (1 - Math.abs(y + 0.25) / HALF_H);
  return PACK_T * sideProfile(x) * end * belly;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 1-D value noise in -1…1. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i + seed * 17.3) * (1 - u) + hash(i + 1 + seed * 17.3) * u) * 2 - 1;
}

/** The ragged edge the top strip tears along, at `x`. The strip and the body use the same line. */
export function tearEdgeY(x: number): number {
  return TEAR_Y + 0.02 * noise1(x * 7.3, 1) + 0.011 * noise1(x * 23, 2) + 0.005 * noise1(x * 61, 3);
}

// --- the peeling strip ---------------------------------------------------------------------------

/**
 * Where a point of the torn strip ends up. Think of the strip as a ribbon hinged at the tear front:
 * behind the front it leaves the pack heading back along the tear and curls up toward the viewer.
 * The path is the integral of a heading that turns from 0 to `thetaMax` over `curl` units.
 */
export interface PeelPath {
  /** Distance behind the tear front each sample is at. */
  ds: number;
  /** Displacement along the tear axis (measured back from the front) and out along z. */
  back: Float32Array;
  out: Float32Array;
  /** The ribbon's heading at each sample (0 = lying flat along the tear). */
  theta: Float32Array;
}

export function buildPeelPath(thetaMax: number, curl: number, length = PACK_W + 0.3, steps = 128): PeelPath {
  const ds = length / steps;
  const back = new Float32Array(steps + 1);
  const out = new Float32Array(steps + 1);
  const theta = new Float32Array(steps + 1);
  for (let i = 0; i <= steps; i++) theta[i] = thetaMax * smoothstep(0, curl, i * ds);
  for (let i = 1; i <= steps; i++) {
    const mid = (theta[i - 1] + theta[i]) / 2;
    back[i] = back[i - 1] + Math.cos(mid) * ds;
    out[i] = out[i - 1] + Math.sin(mid) * ds;
  }
  return { ds, back, out, theta };
}

function sample(arr: Float32Array, ds: number, b: number): number {
  const f = Math.min(arr.length - 1, Math.max(0, b / ds));
  const i = Math.floor(f);
  const j = Math.min(arr.length - 1, i + 1);
  return arr[i] + (arr[j] - arr[i]) * (f - i);
}

export interface Peeled {
  /** Shift along the tear axis, in the direction the tear travels (the curled ribbon folds back toward the front). */
  da: number;
  dy: number;
  dz: number;
}

/**
 * Displacement for a strip vertex that is `b` behind the tear front (b <= 0: not torn yet, stays
 * put) and sits `z0` off the strip's middle plane (the pack's thickness, tiny on a flat strip).
 */
export function peelOffset(path: PeelPath, b: number, z0: number): Peeled {
  if (b <= 0) return { da: 0, dy: 0, dz: 0 };
  const back = sample(path.back, path.ds, b);
  const out = sample(path.out, path.ds, b);
  const th = sample(path.theta, path.ds, b);
  // Position on the path, plus the vertex's offset along the ribbon's normal, which is
  // (sinθ, cosθ) in (tear axis, z) while the heading is (-cosθ, sinθ).
  const along = back - Math.sin(th) * z0;
  const zz = out + Math.cos(th) * z0;
  // The flat strip would have this point `b` back and z0 out, so the difference is the shift.
  return { da: b - along, dy: 0.26 * smoothstep(0, 1.3, b), dz: zz - z0 };
}
