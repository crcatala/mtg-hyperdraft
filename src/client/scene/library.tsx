// Arcane library: a round stone study lined with towering bookcases and tall moonlit windows, a summoning circle
// slowly turning on the floor under the table, candles and open books floating around the room, a brass orrery,
// a globe and a cluster of humming crystals.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { bookshelfTexture, flagstoneTexture, magicCircleTexture, seeded, tiled } from "./sceneTextures";
import { Candle, Floor, FLOOR_Y, Motes, Scatter, around, ringSpots, sceneTime, type ScatterItem } from "./bits";
import { At } from "./tavern";
import { glowTexture } from "../table/textures";

const FLAT = -Math.PI / 2;
const WALL_R = 122;
const SLOTS = 16;
/** Slots (of 16 around the wall) that hold a window instead of a bookcase. */
const WINDOWS = new Set([0, 4, 8, 12]);

export function Library({ radius: R }: { radius: number }) {
  const floor = tiled(flagstoneTexture([64, 66, 86]), "library-floor", [12, 12]);
  const wall = tiled(flagstoneTexture([54, 52, 68]), "library-wall", [16, 2.6]);
  return (
    <group>
      <Floor map={floor} color="#9ea4bc" />
      <MagicCircle radius={R + 26} />
      <mesh position-y={FLOOR_Y + 85}>
        <cylinderGeometry args={[WALL_R, WALL_R, 170, SLOTS, 1, true]} />
        <meshStandardMaterial map={wall} side={THREE.BackSide} color="#8a8ca0" roughness={0.95} />
      </mesh>
      {Array.from({ length: SLOTS }, (_, k) => {
        const a = (k / SLOTS) * Math.PI * 2;
        return WINDOWS.has(k) ? <ArchedWindow key={k} a={a} /> : <Bookcase key={k} a={a} />;
      })}
      <Lectern a={Math.PI + 0.5} r={R + 34} />
      <Orrery a={Math.PI - 0.62} r={R + 38} />
      <Globe a={Math.PI / 2 + 0.62} r={R + 38} />
      <Crystals a={-Math.PI / 2 - 0.55} r={R + 36} />
      <BookPiles radius={R} />
      <FloatingCandles radius={R} />
      <FloatingBooks radius={R} />
      <Motes count={70} box={[-(R + 26), FLOOR_Y + 1, -(R + 26), R + 26, -4, R + 26]} color="#a88bff" size={0.6} rise={3.2} wander={1.2} seed={4} />
    </group>
  );
}

function MagicCircle({ radius }: { radius: number }) {
  const ring = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    if (ring.current) ring.current.rotation.z = t * 0.025;
    if (mat.current) mat.current.opacity = 0.42 + Math.sin(t * 0.8) * 0.12;
  });
  return (
    <mesh ref={ring} rotation-x={FLAT} position-y={FLOOR_Y + 0.2}>
      <circleGeometry args={[radius, 96]} />
      <meshBasicMaterial ref={mat} map={magicCircleTexture()} color="#9a78ff" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

function Bookcase({ a }: { a: number }) {
  const width = 2 * (WALL_R - 8) * Math.tan(Math.PI / SLOTS) - 2;
  return (
    <At a={a} r={WALL_R - 8}>
      <mesh position-y={60}>
        <boxGeometry args={[width, 120, 12]} />
        <meshStandardMaterial map={bookshelfTexture()} roughness={0.85} />
      </mesh>
      <mesh position-y={122}>
        <boxGeometry args={[width + 2, 4, 15]} />
        <meshStandardMaterial color="#3a2414" roughness={0.6} />
      </mesh>
    </At>
  );
}

function ArchedWindow({ a }: { a: number }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-14, 0);
    s.lineTo(14, 0);
    s.lineTo(14, 70);
    s.absarc(0, 70, 14, 0, Math.PI, false);
    s.lineTo(-14, 0);
    return new THREE.ShapeGeometry(s, 16);
  }, []);
  return (
    <At a={a} r={WALL_R - 1.5}>
      <mesh geometry={shape} position-y={30} rotation-y={Math.PI}>
        <meshBasicMaterial color="#26386a" />
      </mesh>
      <mesh geometry={shape} position={[0, 30, -0.5]} rotation-y={Math.PI}>
        <meshBasicMaterial color="#8aa6ff" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {[
        [0, 72, 1.6, 84],
        [0, 60, 28, 1.6],
        [0, 88, 28, 1.6],
        [0, 30, 34, 3],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, -1]}>
          <boxGeometry args={[w, h, 2]} />
          <meshStandardMaterial color="#2a2533" roughness={0.8} />
        </mesh>
      ))}
      <Motes count={18} box={[-12, 34, -30, 12, 96, -4]} color="#b4c6ff" size={0.45} wander={1.2} seed={Math.round(a * 10)} />
    </At>
  );
}

const brass = { color: "#c79b4f", metalness: 0.85, roughness: 0.3 } as const;

function Lectern({ a, r }: { a: number; r: number }) {
  return (
    <At a={a} r={r}>
      <mesh position-y={1}>
        <cylinderGeometry args={[6, 7, 2, 8]} />
        <meshStandardMaterial color="#3a2414" roughness={0.6} />
      </mesh>
      <mesh position-y={20}>
        <cylinderGeometry args={[1.6, 2.2, 38, 8]} />
        <meshStandardMaterial color="#3a2414" roughness={0.6} />
      </mesh>
      <group position-y={40} rotation-x={-0.45}>
        <mesh>
          <boxGeometry args={[18, 1.4, 13]} />
          <meshStandardMaterial color="#4b2c1b" roughness={0.55} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 4.2, 1.1, 0]} rotation-z={-s * 0.08}>
            <boxGeometry args={[8.2, 0.8, 11]} />
            <meshStandardMaterial color="#efe3c6" roughness={0.9} />
          </mesh>
        ))}
      </group>
      <Candle position={[10, 40, 4]} h={3.5} r={0.6} seed={21} />
    </At>
  );
}

function Orrery({ a, r }: { a: number; r: number }) {
  const rings = useRef<THREE.Group>(null);
  const arms = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    if (rings.current) rings.current.rotation.y = t * 0.08;
    arms.current.forEach((g, i) => g && (g.rotation.y = t * (0.5 / (i + 1)) + i));
  });
  return (
    <At a={a} r={r}>
      <mesh position-y={1.5}>
        <cylinderGeometry args={[7, 8, 3, 16]} />
        <meshStandardMaterial {...brass} />
      </mesh>
      <mesh position-y={17}>
        <cylinderGeometry args={[0.9, 1.4, 30, 10]} />
        <meshStandardMaterial {...brass} />
      </mesh>
      <group position-y={42}>
        <mesh>
          <sphereGeometry args={[3, 20, 14]} />
          <meshStandardMaterial color="#ffd27a" emissive="#ffb030" emissiveIntensity={1.4} />
        </mesh>
        <sprite scale={[14, 14, 1]}>
          <spriteMaterial map={glowTexture()} color="#ffbe55" transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
        <group ref={rings}>
          {[
            [10, 0.4, 0],
            [12, 1.1, 0.5],
            [11, -0.7, 1.2],
          ].map(([rad, tilt, spin], i) => (
            <mesh key={i} rotation={[Math.PI / 2 + tilt, spin, 0]}>
              <torusGeometry args={[rad, 0.25, 6, 48]} />
              <meshStandardMaterial {...brass} />
            </mesh>
          ))}
        </group>
        {[5.5, 8.5, 12.5].map((d, i) => (
          <group key={d} ref={(g) => void (arms.current[i] = g)}>
            <mesh position-x={d}>
              <sphereGeometry args={[0.7 + i * 0.35, 14, 10]} />
              <meshStandardMaterial color={["#9ab3d8", "#c26a4a", "#8fc28a"][i]} roughness={0.6} />
            </mesh>
            <mesh position-x={d / 2} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.12, 0.12, d, 4]} />
              <meshStandardMaterial {...brass} />
            </mesh>
          </group>
        ))}
      </group>
    </At>
  );
}

function Globe({ a, r }: { a: number; r: number }) {
  const ball = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ball.current) ball.current.rotation.y = sceneTime(clock) * 0.15;
  });
  const tex = useMemo(() => {
    // A little hand-drawn world: blue sea, a few tan continents.
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#2c4a6a";
    ctx.fillRect(0, 0, 512, 256);
    const rand = seeded(61);
    ctx.fillStyle = "#c7ab74";
    for (let i = 0; i < 9; i++) {
      const cx = rand() * 512;
      const cy = 40 + rand() * 176;
      ctx.beginPath();
      for (let k = 0; k < 14; k++) {
        const ang = (k / 14) * Math.PI * 2;
        const rr = 18 + rand() * 30;
        const x = cx + Math.cos(ang) * rr * 1.4;
        const y = cy + Math.sin(ang) * rr;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <At a={a} r={r}>
      {[0, 1, 2].map((k) => (
        <mesh key={k} position={[Math.cos((k / 3) * Math.PI * 2) * 4, 9, Math.sin((k / 3) * Math.PI * 2) * 4]} rotation={[0, -(k / 3) * Math.PI * 2, 0.2]}>
          <cylinderGeometry args={[0.7, 0.9, 19, 6]} />
          <meshStandardMaterial color="#3a2414" roughness={0.6} />
        </mesh>
      ))}
      <mesh position-y={19}>
        <torusGeometry args={[7.5, 0.6, 6, 32]} />
        <meshStandardMaterial color="#3a2414" roughness={0.6} />
      </mesh>
      <group position-y={26} rotation-z={0.4}>
        <mesh ref={ball}>
          <sphereGeometry args={[7, 28, 18]} />
          <meshStandardMaterial map={tex} roughness={0.5} />
        </mesh>
        <mesh rotation-y={Math.PI / 2}>
          <torusGeometry args={[7.8, 0.3, 6, 40]} />
          <meshStandardMaterial {...brass} />
        </mesh>
      </group>
    </At>
  );
}

function Crystals({ a, r }: { a: number; r: number }) {
  const group = useRef<THREE.Group>(null);
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const shards = useMemo(() => {
    const rand = seeded(29);
    return Array.from({ length: 9 }, (_, i) => ({
      x: (rand() - 0.5) * 14,
      z: (rand() - 0.5) * 10,
      h: 6 + rand() * 14,
      tilt: (rand() - 0.5) * 0.7,
      spin: rand() * 6,
      hue: i % 3 === 0 ? "#5fd8ff" : "#a183ff",
    }));
  }, []);
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    mats.current.forEach((m, i) => m && (m.emissiveIntensity = 0.7 + Math.sin(t * 1.4 + i * 0.9) * 0.35));
  });
  return (
    <At a={a} r={r}>
      <group ref={group}>
        <mesh position-y={1.2} scale={[1, 0.4, 0.8]}>
          <dodecahedronGeometry args={[9, 0]} />
          <meshStandardMaterial color="#3d3a48" roughness={0.95} flatShading />
        </mesh>
        {shards.map((s, i) => (
          <mesh key={i} position={[s.x, 3 + s.h / 2, s.z]} rotation={[s.tilt, s.spin, s.tilt * 0.6]}>
            <cylinderGeometry args={[0, 1.6, s.h, 6]} />
            <meshStandardMaterial ref={(m) => void (mats.current[i] = m)} color={s.hue} emissive={s.hue} emissiveIntensity={0.8} roughness={0.15} flatShading transparent opacity={0.92} />
          </mesh>
        ))}
        <sprite position-y={10} scale={[34, 34, 1]}>
          <spriteMaterial map={glowTexture()} color="#8f7bff" transparent opacity={0.32} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      </group>
    </At>
  );
}

function BookPiles({ radius: R }: { radius: number }) {
  const { items, geo, mat } = useMemo(() => {
    const rand = seeded(73);
    const colors = ["#6e1e22", "#24405e", "#2a5234", "#6a4a20", "#45285a", "#2a2a30"];
    const out: ScatterItem[] = [];
    for (const spot of ringSpots(9, R + 18, R + 58, 33, [
      [Math.PI + 0.5, 0.25],
      [Math.PI - 0.62, 0.25],
      [Math.PI / 2 + 0.62, 0.25],
      [-Math.PI / 2 - 0.55, 0.3],
    ])) {
      const [x, z] = around(spot.a, spot.r);
      const n = 2 + Math.floor(spot.k * 5);
      let y = FLOOR_Y;
      for (let i = 0; i < n; i++) {
        const t = 1.2 + rand() * 1.1;
        out.push({ p: [x + (rand() - 0.5), y + t / 2, z + (rand() - 0.5)], r: [0, rand() * Math.PI, 0], s: [7 + rand() * 3, t, 9 + rand() * 3], color: colors[Math.floor(rand() * colors.length)] });
        y += t;
      }
    }
    return { items: out, geo: new THREE.BoxGeometry(1, 1, 1), mat: new THREE.MeshStandardMaterial({ roughness: 0.8 }) };
  }, [R]);
  return <Scatter geometry={geo} material={mat} items={items} />;
}

/** Candles hanging in the air around the room, each bobbing on its own. */
function FloatingCandles({ radius: R }: { radius: number }) {
  const spots = useMemo(() => ringSpots(16, R + 22, R + 70, 47).map((s) => ({ ...s, y: 4 + s.k * 20 })), [R]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    refs.current.forEach((g, i) => g && (g.position.y = spots[i].y + Math.sin(t * 0.7 + i * 1.9) * 1.4));
  });
  return (
    <>
      {spots.map((s, i) => {
        const [x, z] = around(s.a, s.r);
        return (
          <group key={i} ref={(g) => void (refs.current[i] = g)} position={[x, s.y, z]}>
            <Candle position={[0, 0, 0]} h={3 + s.k * 4} r={0.6} seed={i * 0.7} />
          </group>
        );
      })}
    </>
  );
}

/** A few open books drifting round the room on a slow orbit, pages gently flapping. */
function FloatingBooks({ radius: R }: { radius: number }) {
  const count = 5;
  const books = useRef<(THREE.Group | null)[]>([]);
  const halves = useRef<(THREE.Group | null)[]>([]);
  const covers = ["#6e1e22", "#24405e", "#2a5234", "#45285a", "#6a4a20"];
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    books.current.forEach((g, i) => {
      if (!g) return;
      const a = t * 0.045 + (i / count) * Math.PI * 2;
      const r = R + 30 + Math.sin(t * 0.2 + i) * 4;
      const [x, z] = around(a, r);
      g.position.set(x, 10 + i * 2 + Math.sin(t * 0.9 + i * 2) * 1.5, z);
      g.rotation.y = -a + Math.PI / 2;
      g.rotation.z = Math.sin(t * 0.5 + i) * 0.12;
    });
    halves.current.forEach((h, j) => {
      if (!h) return;
      const i = Math.floor(j / 2);
      const side = j % 2 === 0 ? 1 : -1;
      h.rotation.z = side * (0.28 + Math.max(0, Math.sin(t * 2.2 + i * 1.3)) * 0.28);
    });
  });
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} ref={(g) => void (books.current[i] = g)}>
          {[1, -1].map((side, k) => (
            <group key={side} ref={(h) => void (halves.current[i * 2 + k] = h)}>
              <mesh position-x={side * 2.4}>
                <boxGeometry args={[4.8, 0.25, 6.6]} />
                <meshStandardMaterial color={covers[i]} roughness={0.7} />
              </mesh>
              <mesh position={[side * 2.25, 0.35, 0]}>
                <boxGeometry args={[4.4, 0.45, 6.2]} />
                <meshStandardMaterial color="#efe3c6" roughness={0.9} emissive="#ffe8b0" emissiveIntensity={0.12} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </>
  );
}
