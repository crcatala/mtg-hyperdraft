// three.js geometry for the pack. Each face (front, back) is split along the ragged tear line into
// the body and the top strip, sharing the same edge so they fit together until torn. The strip is
// deformed on the CPU every frame while it peels (it's a few thousand vertices); the body's top edge
// gapes open behind the tear front like the mouth of a torn bag.

import * as THREE from "three";
import { HALF_H, HALF_W, PACK_H, PACK_W, halfThickness, sideProfile, smoothstep, tearEdgeY, peelOffset, type PeelPath } from "./packShape";
import type { TearDir } from "./tearGesture";

const NX = 80;
const BODY_ROWS = 72;
const STRIP_ROWS = 12;
/** A sealed strip is nearly flat; give it a little thickness so its two faces never z-fight. */
const STRIP_Z = 0.014;
/** How far below the tear line the body's edge gapes open. */
const MOUTH_REACH = 0.8;

export interface Face {
  geo: THREE.BufferGeometry;
  /** Undeformed positions. */
  base: Float32Array;
  /** Tear-line height in each vertex's column (for the body's mouth). */
  cut: Float32Array;
  part: "body" | "strip";
  /** +1 front (bulges to +z), -1 back. */
  side: 1 | -1;
}

export function buildFace(part: "body" | "strip", side: 1 | -1): Face {
  const cols = NX + 1;
  const rows = (part === "body" ? BODY_ROWS : STRIP_ROWS) + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const cut = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = -HALF_W + (i / NX) * PACK_W;
      const edge = tearEdgeY(x);
      const t = j / (rows - 1);
      const y = part === "body" ? -HALF_H + t * (edge + HALF_H) : edge + t * (HALF_H - edge);
      const z = side * Math.max(halfThickness(x, y), STRIP_Z);
      const v = j * cols + i;
      pos.set([x, y, z], v * 3);
      uv.set([x / PACK_W + 0.5, y / PACK_H + 0.5], v * 2);
      cut[v] = edge;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Counter-clockwise seen from the face's own side.
      if (side === 1) index.push(a, b, d, a, d, c);
      else index.push(a, d, b, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos.slice(), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // Deformed strips and the gaping mouth leave the undeformed bounds, so never cull by them.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
  return { geo, base: pos, cut, part, side };
}

/** Where the tear front is along x (for direction `dir`) at progress p (0 = corner, 1 = far corner). */
export function frontX(p: number, dir: TearDir): number {
  return dir * (-HALF_W + p * PACK_W);
}

/** Lays the strip out for tear progress `p`: untouched ahead of the front, curling away behind it. */
export function peelStrip(face: Face, p: number, dir: TearDir, path: PeelPath, time: number) {
  const attr = face.geo.attributes.position as THREE.BufferAttribute;
  const pos = attr.array as Float32Array;
  const af = -HALF_W + p * PACK_W;
  for (let v = 0; v < pos.length / 3; v++) {
    const x = face.base[v * 3];
    const y = face.base[v * 3 + 1];
    const z = face.base[v * 3 + 2];
    const a = dir * x;
    const b = af - a;
    if (b <= 0) {
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z;
      continue;
    }
    const o = peelOffset(path, b, z);
    // The torn flap trembles a little, more at its loose end.
    const flutter = 0.035 * Math.sin(b * 8 - time * 15) * smoothstep(0.2, 1.4, b);
    pos[v * 3] = dir * (a + o.da);
    pos[v * 3 + 1] = y + o.dy + flutter;
    pos[v * 3 + 2] = z + o.dz;
  }
  attr.needsUpdate = true;
  face.geo.computeVertexNormals();
}

/** Opens the body's top edge behind the tear front: front bulges forward, back backward. */
export function openMouth(face: Face, p: number, dir: TearDir, open: number) {
  const attr = face.geo.attributes.position as THREE.BufferAttribute;
  const pos = attr.array as Float32Array;
  const af = -HALF_W + p * PACK_W;
  for (let v = 0; v < pos.length / 3; v++) {
    const x = face.base[v * 3];
    const y = face.base[v * 3 + 1];
    const reach = (y - (face.cut[v] - MOUTH_REACH)) / MOUTH_REACH;
    if (reach <= 0) {
      pos[v * 3 + 2] = face.base[v * 3 + 2];
      continue;
    }
    const torn = smoothstep(0, 0.5, af - dir * x);
    const gape = open * torn * smoothstep(0, 1, reach) * sideProfile(x);
    pos[v * 3 + 2] = face.base[v * 3 + 2] + face.side * gape;
  }
  attr.needsUpdate = true;
  face.geo.computeVertexNormals();
}
