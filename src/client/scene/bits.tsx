// Small building blocks shared by the tables and environments: flickering flames, drifting motes and fireflies,
// instanced scatter. Everything that moves holds still for players who prefer reduced motion.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { dotTexture, flameDotTexture, flameTexture, seeded } from "./sceneTextures";
import { glowTexture } from "../table/textures";
import { reducedMotion } from "../table/motion";

/** Table height in world units (inches): the floor sits this far below the table top. */
export const FLOOR_Y = -29;

/**
 * Calls `onSlow` once if the frame rate stays under `fps` for a few seconds (after a short warm-up), so a canvas
 * can drop to 1x pixel density on a GPU that can't keep up.
 */
export function WhenSlow({ onSlow, fps = 40 }: { onSlow: () => void; fps?: number }) {
  const s = useRef({ start: -1, frames: 0, slow: 0, done: false });
  useFrame(() => {
    const st = s.current;
    if (st.done) return;
    const now = performance.now();
    if (st.start < 0) st.start = now + 1500;
    if (now < st.start) return;
    st.frames++;
    if (now - st.start < 1000) return;
    const rate = (st.frames * 1000) / (now - st.start);
    st.slow = rate < fps ? st.slow + 1 : 0;
    st.frames = 0;
    st.start = now;
    if (st.slow >= 3) {
      st.done = true;
      onSlow();
    }
  });
  return null;
}

/** Seconds since the scene started, or a fixed moment when motion is reduced (so things hold a nice pose). */
export function sceneTime(clock: THREE.Clock): number {
  return reducedMotion() ? 2.5 : clock.elapsedTime;
}

/** Table point at angle `a` (radians, as seatAngle measures it: 0 is seat 0 at +z) and distance `r` from the centre. */
export function around(a: number, r: number): [number, number] {
  return [-Math.sin(a) * r, Math.cos(a) * r];
}

/**
 * A candle or torch flame: an additive teardrop that flickers, over a soft glow. `size` is the flame's height.
 */
export function Flame({ position, size = 1, color = "#ffb45a", glow = 2.6, seed = 0 }: { position: [number, number, number]; size?: number; color?: string; glow?: number; seed?: number }) {
  const flame = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Sprite>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock) + seed * 7.3;
    const f = 1 + Math.sin(t * 11) * 0.07 + Math.sin(t * 23.7) * 0.05 + Math.sin(t * 5.3) * 0.06;
    if (flame.current) {
      flame.current.scale.set(size * 0.5 * (2 - f), size * f, 1);
      flame.current.position.y = position[1] + (size * f) / 2 - size * 0.12;
    }
    if (halo.current) (halo.current.material as THREE.SpriteMaterial).opacity = 0.32 + (f - 1) * 1.2;
  });
  return (
    <>
      <sprite ref={halo} position={[position[0], position[1] + size * 0.35, position[2]]} scale={[size * glow, size * glow, 1]}>
        <spriteMaterial map={glowTexture()} color={color} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </sprite>
      <sprite ref={flame} position={position} scale={[size * 0.5, size, 1]}>
        <spriteMaterial map={flameTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </sprite>
    </>
  );
}

interface CandleEntry {
  anchor: THREE.Object3D;
  h: number;
  r: number;
  seed: number;
}

const CandleRegistry = createContext<{ add: (e: CandleEntry) => () => void } | null>(null);

/**
 * A candle: wax column with a flame on top. `h` is the wax height; the base sits at `position`. Inside a
 * CandleBatch it only marks its spot, and the batch draws every candle at once; on its own it draws itself.
 */
export function Candle({ position, h = 3, r = 0.45, seed = 0, wax = "#efe2c4" }: { position: [number, number, number]; h?: number; r?: number; seed?: number; wax?: string }) {
  const batch = useContext(CandleRegistry);
  const anchor = useRef<THREE.Group>(null);
  useLayoutEffect(() => (batch && anchor.current ? batch.add({ anchor: anchor.current, h, r, seed }) : undefined), [batch, h, r, seed]);
  if (batch) return <group ref={anchor} position={position} />;
  return (
    <group position={position}>
      <mesh position-y={h / 2}>
        <cylinderGeometry args={[r * 0.92, r, h, 14]} />
        <meshStandardMaterial color={wax} roughness={0.6} emissive="#ff9a40" emissiveIntensity={0.08} />
      </mesh>
      <Flame position={[0, h + 0.05, 0]} size={r * 2.4} seed={seed} />
    </group>
  );
}

/**
 * Draws every Candle inside it in three draw calls (wax, flames, halos) instead of three per candle. Candles may
 * sit anywhere in the tree, moving parents included (floating candles): their spots are read every frame.
 */
export function CandleBatch({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<CandleEntry[]>([]);
  const registry = useMemo(
    () => ({
      add: (e: CandleEntry) => {
        setEntries((list) => [...list, e]);
        return () => setEntries((list) => list.filter((x) => x !== e));
      },
    }),
    [],
  );
  return (
    <CandleRegistry.Provider value={registry}>
      {children}
      {entries.length > 0 && <CandleMeshes key={entries.length} entries={entries} />}
    </CandleRegistry.Provider>
  );
}

const WAX_GEO = new THREE.CylinderGeometry(0.92, 1, 1, 12).translate(0, 0.5, 0);

function CandleMeshes({ entries }: { entries: CandleEntry[] }) {
  const n = entries.length;
  const wax = useRef<THREE.InstancedMesh>(null);
  const waxMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#efe2c4", roughness: 0.6, emissive: "#ff9a40", emissiveIntensity: 0.08 }), []);
  const { flames, halos } = useMemo(() => {
    const make = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      return g;
    };
    return { flames: make(), halos: make() };
  }, [n]);
  useEffect(
    () => () => {
      waxMat.dispose();
      flames.dispose();
      halos.dispose();
    },
    [waxMat, flames, halos],
  );
  const m = useMemo(() => new THREE.Matrix4(), []);
  const local = useMemo(() => new THREE.Matrix4(), []);
  const size = useMemo(() => new THREE.Matrix4(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const warm = useMemo(() => new THREE.Color("#ffb45a"), []);

  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    const im = wax.current;
    const fp = flames.attributes.position as THREE.BufferAttribute;
    const fc = flames.attributes.color as THREE.BufferAttribute;
    const hp = halos.attributes.position as THREE.BufferAttribute;
    const hc = halos.attributes.color as THREE.BufferAttribute;
    entries.forEach((e, i) => {
      e.anchor.updateWorldMatrix(true, false);
      m.copy(e.anchor.matrixWorld);
      if (im) im.setMatrixAt(i, local.copy(m).multiply(size.makeScale(e.r, e.h, e.r)));
      const ts = t + e.seed * 7.3;
      const f = 1 + Math.sin(ts * 11) * 0.07 + Math.sin(ts * 23.7) * 0.05 + Math.sin(ts * 5.3) * 0.06;
      v.set(0, e.h + e.r * 1.1 * f, 0).applyMatrix4(m);
      fp.setXYZ(i, v.x, v.y, v.z);
      fc.setXYZ(i, f, f, f);
      hp.setXYZ(i, v.x, v.y - e.r * 0.3, v.z);
      const k = 0.42 + (f - 1) * 1.4;
      hc.setXYZ(i, warm.r * k, warm.g * k, warm.b * k);
    });
    if (im) im.instanceMatrix.needsUpdate = true;
    for (const a of [fp, fc, hp, hc]) a.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={wax} args={[WAX_GEO, waxMat, n]} frustumCulled={false} />
      <points geometry={halos} frustumCulled={false}>
        <pointsMaterial map={glowTexture()} size={4.4} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </points>
      <points geometry={flames} frustumCulled={false}>
        <pointsMaterial map={flameDotTexture()} size={2} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </points>
    </>
  );
}

/** A point light whose brightness wavers like firelight. */
export function FlickerLight({ position, color, intensity, distance, seed = 0, decay = 1.4 }: { position: [number, number, number]; color: string; intensity: number; distance: number; seed?: number; decay?: number }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (!light.current) return;
    const t = sceneTime(clock) + seed;
    light.current.intensity = intensity * (1 + Math.sin(t * 9.1) * 0.08 + Math.sin(t * 17.3) * 0.06 + Math.sin(t * 3.7) * 0.05);
  });
  return <pointLight ref={light} position={position} color={color} intensity={intensity} distance={distance} decay={decay} />;
}

/**
 * Specks drifting in a box (dust in lamplight, magic sparkles, fireflies). With `blink`, each one fades in and out on
 * its own rhythm, like a firefly; `rise` makes them float upwards and wrap around.
 */
export function Motes({
  count,
  box,
  color,
  size = 0.5,
  blink = false,
  rise = 0,
  wander = 1,
  seed = 1,
}: {
  count: number;
  /** [x0, y0, z0, x1, y1, z1] */
  box: [number, number, number, number, number, number];
  color: string;
  size?: number;
  blink?: boolean;
  rise?: number;
  wander?: number;
  seed?: number;
}) {
  const points = useRef<THREE.Points>(null);
  const data = useMemo(() => {
    const rand = seeded(seed * 101 + count);
    const base = new Float32Array(count * 3);
    const phase = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      base[i * 3] = box[0] + rand() * (box[3] - box[0]);
      base[i * 3 + 1] = box[1] + rand() * (box[4] - box[1]);
      base[i * 3 + 2] = box[2] + rand() * (box[5] - box[2]);
      phase[i * 3] = rand() * 100;
      phase[i * 3 + 1] = 0.4 + rand() * 0.8;
      phase[i * 3 + 2] = rand();
    }
    return { base, phase };
    // The box is a fresh array each render; its numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, seed, ...box]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.base.slice(), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3((box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2), Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2]) / 2 + 4);
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const tint = useMemo(() => new THREE.Color(color), [color]);

  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    const h = box[4] - box[1];
    for (let i = 0; i < count; i++) {
      const p = data.phase[i * 3];
      const sp = data.phase[i * 3 + 1];
      let y = data.base[i * 3 + 1] + Math.sin(t * 0.6 * sp + p) * wander * 0.8;
      if (rise) y = box[1] + ((((data.base[i * 3 + 1] - box[1] + t * rise * sp) % h) + h) % h);
      pos.setXYZ(i, data.base[i * 3] + Math.sin(t * 0.37 * sp + p) * wander * 2, y, data.base[i * 3 + 2] + Math.cos(t * 0.29 * sp + p * 1.3) * wander * 2);
      let k = 1;
      if (blink) {
        const b = Math.sin(t * 1.3 * sp + p * 3);
        k = b > 0.2 ? Math.min(1, (b - 0.2) * 2.5) : 0.04;
      } else if (rise) {
        // Fade in at the bottom and out at the top of the box.
        const u = (y - box[1]) / h;
        k = Math.min(1, u * 5, (1 - u) * 3);
      }
      col.setXYZ(i, tint.r * k, tint.g * k, tint.b * k);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial map={dotTexture()} size={size} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
    </points>
  );
}

/**
 * The ground: a big textured disc at floor level that darkens away from the table (a pool of light under it fading
 * into the room). The shading is baked into vertex colours, so it costs nothing beyond the floor itself.
 */
export function Floor({ map, color, radius = 400, light = 48, dark = 210, floor = 0.2 }: { map: THREE.Texture; color: string; radius?: number; light?: number; dark?: number; floor?: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.RingGeometry(0.01, radius, 64, 20);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      const u = THREE.MathUtils.clamp((r - light) / (dark - light), 0, 1);
      const k = 1 - (1 - floor) * u * u * (3 - 2 * u);
      colors.set([k, k, k], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [radius, light, dark, floor]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} rotation-x={-Math.PI / 2} position-y={FLOOR_Y}>
      <meshStandardMaterial map={map} color={color} vertexColors roughness={0.85} />
    </mesh>
  );
}

export interface ScatterItem {
  p: [number, number, number];
  /** Euler angles (radians). */
  r?: [number, number, number];
  s?: number | [number, number, number];
  color?: string;
}

/**
 * Many copies of one mesh in a single draw call (books, stones, mushrooms, tree trunks...). Takes ownership of
 * `geometry` and `material` and frees them when it goes.
 */
export function Scatter({ geometry, material, items }: { geometry: THREE.BufferGeometry; material: THREE.Material; items: ScatterItem[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      e.set(...(it.r ?? [0, 0, 0]));
      q.setFromEuler(e);
      if (typeof it.s === "number" || it.s === undefined) s.setScalar(it.s ?? 1);
      else s.set(...it.s);
      m.compose(v.set(...it.p), q, s);
      mesh.setMatrixAt(i, m);
      if (it.color) mesh.setColorAt(i, c.set(it.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} />;
}

/** Spreads `n` items around a ring between radii r0..r1, skipping arcs given as [centre, half-width] (radians). */
export function ringSpots(n: number, r0: number, r1: number, seed: number, skip: [number, number][] = []): { a: number; r: number; k: number }[] {
  const rand = seeded(seed);
  const out: { a: number; r: number; k: number }[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 20) {
    const a = rand() * Math.PI * 2;
    const blocked = skip.some(([c, w]) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) < w);
    const r = r0 + rand() * (r1 - r0);
    const k = rand();
    if (!blocked) out.push({ a, r, k });
  }
  return out;
}
