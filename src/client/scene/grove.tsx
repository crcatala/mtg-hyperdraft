// Moonlit grove: the table stands on old paving in a forest clearing at night, ringed by standing stones with
// softly glowing runes, under a starry sky and a big moon. Pines sway, fireflies blink, mushrooms glow, and an owl
// on one of the stones looks around now and then.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { flagstoneTexture, grassTexture, nightSkyTexture, runeGlyphTexture, seeded, tiled } from "./sceneTextures";
import { Candle, Floor, FLOOR_Y, FlickerLight, Motes, Scatter, around, ringSpots, sceneTime, type ScatterItem } from "./bits";
import { At } from "./tavern";
import { glowTexture } from "../table/textures";
import { reducedMotion } from "../table/motion";

const FLAT = -Math.PI / 2;
const SKY_R = 480;
/** Where the moon hangs: far side of seat 0, a little to the left, and high. */
const MOON_DIR = new THREE.Vector3(-0.42, 0.5, -0.76).normalize();

export function Grove({ radius: R }: { radius: number }) {
  const stones = 9;
  return (
    <group>
      <mesh>
        <sphereGeometry args={[SKY_R, 48, 24]} />
        <meshBasicMaterial map={nightSkyTexture("#22385e", "#050913")} side={THREE.BackSide} fog={false} depthWrite={false} />
      </mesh>
      <Moon />
      <Floor map={tiled(grassTexture(), "grass-ground", [14, 14])} color="#b4ccb8" radius={SKY_R} light={46} dark={250} floor={0.3} />
      <mesh rotation-x={FLAT} position-y={FLOOR_Y + 0.1}>
        <circleGeometry args={[R + 16, 72]} />
        <meshStandardMaterial map={tiled(flagstoneTexture([86, 94, 84]), "grove-paving", [2.4, 2.4])} color="#9aa596" roughness={0.95} />
      </mesh>
      {Array.from({ length: stones }, (_, i) => (
        <StandingStone key={i} a={((i + 0.5) / stones) * Math.PI * 2} r={R + 44} seed={i} owl={i === 4} />
      ))}
      <Pines radius={R} />
      <Undergrowth radius={R} />
      <Mushrooms radius={R} />
      <LanternPost a={Math.PI / 2 + 0.35} r={R + 22} />
      <Motes count={90} box={[-(R + 120), FLOOR_Y + 3, -(R + 120), R + 120, -2, R + 120]} color="#d8ff7a" size={0.9} blink wander={3} seed={8} />
      <Motes count={30} box={[-(R + 160), FLOOR_Y + 20, -(R + 160), R + 160, 40, -(R + 50)]} color="#d8ff7a" size={1.1} blink wander={4} seed={11} />
    </group>
  );
}

function Moon() {
  const p = MOON_DIR.clone().multiplyScalar(SKY_R * 0.9);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(110, 110, 10, 128, 128, 120);
    g.addColorStop(0, "#fffbe8");
    g.addColorStop(0.9, "#e6e2cf");
    g.addColorStop(1, "rgba(230,226,207,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, Math.PI * 2);
    ctx.fill();
    const rand = seeded(2);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(150,150,140,${0.12 + rand() * 0.15})`;
      ctx.beginPath();
      ctx.arc(60 + rand() * 140, 60 + rand() * 140, 6 + rand() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <group position={p}>
      <sprite scale={[160, 160, 1]}>
        <spriteMaterial map={glowTexture()} color="#9fb6ff" transparent opacity={0.35} depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite scale={[46, 46, 1]}>
        <spriteMaterial map={tex} transparent depthWrite={false} fog={false} />
      </sprite>
    </group>
  );
}

/** A rough slab: a box whose corners and edges are knocked about (the same way for every copy of a vertex, so no cracks). */
function roughStone(w: number, h: number, d: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 2, 5, 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const jitter = (x: number, y: number, z: number, k: number) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1 + k * 19.19) * 43758.5453;
    return n - Math.floor(n) - 0.5;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const kx = Math.round(x * 10) / 10;
    const ky = Math.round(y * 10) / 10;
    const kz = Math.round(z * 10) / 10;
    // Taper towards the top, then roughen.
    const taper = 1 - ((y + h / 2) / h) * 0.28;
    pos.setXYZ(i, x * taper + jitter(kx, ky, kz, 1) * w * 0.22, y + jitter(kx, ky, kz, 2) * 2.2, z * taper + jitter(kx, ky, kz, 3) * d * 0.3);
  }
  g.computeVertexNormals();
  return g;
}

function StandingStone({ a, r, seed, owl }: { a: number; r: number; seed: number; owl: boolean }) {
  const shape = useMemo(() => {
    const rand = seeded(seed * 13 + 5);
    const h = 30 + rand() * 14;
    const w = 8 + rand() * 3;
    return { h, w, lean: (rand() - 0.5) * 0.12, twist: (rand() - 0.5) * 0.4, geo: roughStone(w, h, 5, seed) };
  }, [seed]);
  useEffect(() => () => shape.geo.dispose(), [shape]);
  const rune = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (rune.current) rune.current.opacity = 0.55 + Math.sin(sceneTime(clock) * 0.8 + seed) * 0.3;
  });
  return (
    <At a={a} r={r}>
      <group rotation={[shape.lean, shape.twist, shape.lean * 0.5]}>
        <mesh geometry={shape.geo} position-y={shape.h / 2 - 1}>
          <meshStandardMaterial color="#6c736e" roughness={0.95} flatShading />
        </mesh>
        {/* Moss at the foot. */}
        <mesh position-y={1.2} scale={[shape.w * 0.75, 1.6, 3.6]}>
          <sphereGeometry args={[1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#2f4a2c" roughness={1} flatShading />
        </mesh>
        {/* A rune carved on the face turned to the table. */}
        <mesh position={[0, shape.h * 0.58, -2.9]} rotation-y={Math.PI}>
          <planeGeometry args={[shape.w * 0.62, shape.w * 0.62]} />
          <meshBasicMaterial ref={rune} map={runeGlyphTexture(seed * 3 + 1)} color="#7dffb8" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        {owl && <Owl y={shape.h * 0.86} />}
      </group>
    </At>
  );
}

/** An owl perched on a stone: blinks, and turns its head to look around every so often. */
function Owl({ y }: { y: number }) {
  const head = useRef<THREE.Group>(null);
  const lids = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    // Looks left, back at the table, right, back again, holding each pose.
    const c = t % 14;
    const target = c < 3 ? 0 : c < 5.5 ? 1.1 : c < 9 ? 0 : c < 11 ? -0.9 : 0;
    if (head.current) head.current.rotation.y += (target - head.current.rotation.y) * 0.08;
    const blink = t % 4.3 < 0.14;
    if (lids.current) lids.current.scale.y = blink ? 1 : 0.05;
  });
  const feather = <meshStandardMaterial color="#6a5038" roughness={0.95} />;
  return (
    <group position-y={y} rotation-y={Math.PI}>
      <mesh position-y={3} scale={[1, 1.25, 0.9]}>
        <sphereGeometry args={[3, 16, 12]} />
        {feather}
      </mesh>
      <mesh position={[0, 2.4, 2.2]} scale={[0.8, 1, 0.4]}>
        <sphereGeometry args={[2.4, 12, 10]} />
        <meshStandardMaterial color="#c8b08a" roughness={0.95} />
      </mesh>
      <group ref={head} position-y={7}>
        <mesh scale={[1, 0.9, 0.9]}>
          <sphereGeometry args={[2.6, 16, 12]} />
          {feather}
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[s * 1.1, 0.3, 2]}>
              <sphereGeometry args={[0.85, 12, 10]} />
              <meshStandardMaterial color="#ffcc33" emissive="#ffaa00" emissiveIntensity={0.9} />
            </mesh>
            <mesh position={[s * 1.1, 0.3, 2.7]}>
              <sphereGeometry args={[0.35, 8, 6]} />
              <meshBasicMaterial color="#111" />
            </mesh>
            <mesh position={[s * 1.6, 2.2, 0]} rotation-z={-s * 0.4}>
              <coneGeometry args={[0.6, 1.6, 4]} />
              {feather}
            </mesh>
          </group>
        ))}
        <group ref={lids} position={[0, 0.3, 2.1]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position-x={s * 1.1} scale={[1, 1, 0.6]}>
              <sphereGeometry args={[0.95, 10, 8]} />
              {feather}
            </mesh>
          ))}
        </group>
        <mesh position={[0, -0.5, 2.4]} rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.35, 0.9, 4]} />
          <meshStandardMaterial color="#3a2a1a" />
        </mesh>
      </group>
    </group>
  );
}

/** Ranks of pines around the clearing, swaying a little in the night air (two draw calls for all of them). */
function Pines({ radius: R }: { radius: number }) {
  const trees = useMemo(() => {
    const out = [...ringSpots(34, R + 92, R + 150, 19), ...ringSpots(64, R + 150, R + 300, 23)];
    return out.map((s, i) => ({ ...s, h: 55 + s.k * 65, sway: i * 0.37 }));
  }, [R]);
  const trunks = useMemo(() => {
    const items: ScatterItem[] = trees.map((t) => {
      const [x, z] = around(t.a, t.r);
      return { p: [x, FLOOR_Y + t.h * 0.15, z], s: [1 + t.k * 0.6, t.h * 0.3, 1 + t.k * 0.6] };
    });
    const g = new THREE.CylinderGeometry(1.4, 2.2, 1, 6);
    return { items, geo: g, mat: new THREE.MeshStandardMaterial({ color: "#3a2a1e", roughness: 1 }) };
  }, [trees]);
  const cones = useMemo(() => {
    const g = new THREE.ConeGeometry(1, 1, 7);
    g.translate(0, 0.5, 0);
    return { geo: g, mat: new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }) };
  }, []);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const layers = 3;
  const rand = useMemo(() => seeded(37), []);
  const tones = useMemo(() => trees.map(() => ["#1e3a2a", "#234430", "#1a3326", "#2a4a34"][Math.floor(rand() * 4)]), [trees, rand]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const placed = useRef(false);

  useFrame(({ clock }) => {
    const im = mesh.current;
    if (!im) return;
    if (placed.current && reducedMotion()) return;
    const t = sceneTime(clock);
    trees.forEach((tr, i) => {
      const [x, z] = around(tr.a, tr.r);
      const swayX = Math.sin(t * 0.6 + tr.sway) * 0.025;
      const swayZ = Math.cos(t * 0.45 + tr.sway * 1.3) * 0.02;
      for (let l = 0; l < layers; l++) {
        const w = tr.h * (0.25 - l * 0.055);
        const base = tr.h * (0.22 + l * 0.22);
        // Higher layers sway further: lean the whole stack from the ground.
        v.set(x + Math.sin(swayZ) * base, FLOOR_Y + base, z + Math.sin(swayX) * base);
        e.set(swayX * (1 + l * 0.4), 0, -swayZ * (1 + l * 0.4));
        q.setFromEuler(e);
        s.set(w, tr.h * 0.42, w);
        m.compose(v, q, s);
        im.setMatrixAt(i * layers + l, m);
      }
    });
    im.instanceMatrix.needsUpdate = true;
    if (!placed.current) {
      const c = new THREE.Color();
      trees.forEach((_, i) => {
        for (let l = 0; l < layers; l++) im.setColorAt(i * layers + l, c.set(tones[i]).offsetHSL(0, 0, l * 0.025));
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      placed.current = true;
    }
  });

  return (
    <>
      <Scatter geometry={trunks.geo} material={trunks.mat} items={trunks.items} />
      <instancedMesh ref={mesh} args={[cones.geo, cones.mat, trees.length * layers]} frustumCulled={false} />
    </>
  );
}

function Undergrowth({ radius: R }: { radius: number }) {
  const { items, geo, mat } = useMemo(() => {
    const rand = seeded(43);
    const items: ScatterItem[] = ringSpots(70, R + 20, R + 95, 41).map((sp) => {
      const [x, z] = around(sp.a, sp.r);
      const w = 3 + sp.k * 6;
      return { p: [x, FLOOR_Y + w * 0.25, z], r: [0, rand() * 6, 0], s: [w, w * (0.5 + rand() * 0.4), w * (0.8 + rand() * 0.4)], color: ["#26452b", "#315632", "#2a4a2e", "#3a5e36"][Math.floor(rand() * 4)] };
    });
    return { items, geo: new THREE.IcosahedronGeometry(1, 0), mat: new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }) };
  }, [R]);
  return <Scatter geometry={geo} material={mat} items={items} />;
}

/** Clusters of glowing mushrooms near the stones. Their caps breathe light together. */
function Mushrooms({ radius: R }: { radius: number }) {
  const { stems, caps } = useMemo(() => {
    const rand = seeded(59);
    const stems: ScatterItem[] = [];
    const caps: ScatterItem[] = [];
    for (const sp of ringSpots(10, R + 26, R + 60, 57)) {
      const [cx, cz] = around(sp.a, sp.r);
      const n = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const x = cx + (rand() - 0.5) * 6;
        const z = cz + (rand() - 0.5) * 6;
        const h = 1.2 + rand() * 2.4;
        const w = 0.8 + rand() * 1.2;
        stems.push({ p: [x, FLOOR_Y + h / 2, z], s: [w * 0.35, h, w * 0.35] });
        caps.push({ p: [x, FLOOR_Y + h, z], s: [w, w * 0.7, w], color: rand() < 0.3 ? "#7affd0" : "#6ab8ff" });
      }
    }
    return { stems, caps };
  }, [R]);
  const stemPart = useMemo(() => ({ geo: new THREE.CylinderGeometry(1, 1, 1, 6), mat: new THREE.MeshStandardMaterial({ color: "#d8d0bc", roughness: 0.9 }) }), []);
  const capPart = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#57c8ff", emissiveIntensity: 0.9, roughness: 0.4 });
    return { geo, mat };
  }, []);
  useFrame(({ clock }) => {
    capPart.mat.emissiveIntensity = 0.7 + Math.sin(sceneTime(clock) * 0.9) * 0.3;
  });
  return (
    <>
      <Scatter geometry={stemPart.geo} material={stemPart.mat} items={stems} />
      <Scatter geometry={capPart.geo} material={capPart.mat} items={caps} />
    </>
  );
}

function LanternPost({ a, r }: { a: number; r: number }) {
  return (
    <At a={a} r={r}>
      <mesh position-y={27}>
        <cylinderGeometry args={[0.9, 1.3, 54, 8]} />
        <meshStandardMaterial color="#3a2a1e" roughness={1} />
      </mesh>
      <mesh position={[-4, 52, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.5, 0.5, 9, 6]} />
        <meshStandardMaterial color="#3a2a1e" roughness={1} />
      </mesh>
      <group position={[-7.5, 44, 0]}>
        <mesh>
          <boxGeometry args={[4, 6, 4]} />
          <meshStandardMaterial color="#ffd27a" emissive="#ffae40" emissiveIntensity={0.9} transparent opacity={0.6} />
        </mesh>
        <mesh position-y={3.6}>
          <coneGeometry args={[3.2, 2.4, 4]} />
          <meshStandardMaterial color="#26252a" metalness={0.5} roughness={0.5} />
        </mesh>
        <Candle position={[0, -2.4, 0]} h={1.8} r={0.5} seed={5} />
      </group>
      <FlickerLight position={[-7.5, 44, -2]} color="#ffb060" intensity={60} distance={90} decay={1.4} seed={3} />
    </At>
  );
}
