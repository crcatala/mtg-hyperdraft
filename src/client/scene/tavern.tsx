// Tavern hearth: a timbered back room with a crackling fireplace, a bar, barrels, five shields painted in the
// colours of mana, side tables with candles, and a cat asleep by the fire. Sizes in inches, like the table.

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { bookshelfTexture, flagstoneTexture, rugTexture, tiled, timberWallTexture, woodTexture } from "./sceneTextures";
import { Candle, Flame, FlickerLight, Floor, FLOOR_Y, Motes, Scatter, sceneTime, type ScatterItem } from "./bits";
import { seeded } from "./sceneTextures";

const FLAT = -Math.PI / 2;
const WALL_R = 125;

/** Puts its children on the floor at angle `a`, `r` from the centre, their front (-z) facing the table. */
export function At({ a, r, y = 0, children }: { a: number; r: number; y?: number; children: ReactNode }) {
  return (
    <group rotation-y={-a}>
      <group position={[0, FLOOR_Y + y, r]}>{children}</group>
    </group>
  );
}

export function Tavern({ radius: R }: { radius: number }) {
  return (
    <group>
      <Floor map={woodTexture("floor", [16, 16])} color="#a08c78" />
      <mesh rotation-x={FLAT} position-y={FLOOR_Y + 0.12}>
        <circleGeometry args={[R + 22, 96]} />
        <meshStandardMaterial map={rugTexture()} alphaTest={0.5} roughness={1} />
      </mesh>
      <mesh position-y={FLOOR_Y + 75}>
        <cylinderGeometry args={[WALL_R, WALL_R, 150, 12, 1, true]} />
        <meshStandardMaterial map={tiled(timberWallTexture(), "timber-wall", [12, 1.4])} side={THREE.BackSide} color="#9a8a76" roughness={0.95} />
      </mesh>
      <Fireplace />
      <Bar />
      <BarrelStack />
      <Window />
      {[-0.62, 0.62].map((d) => (
        <At key={d} a={Math.PI + d} r={WALL_R - 8}>
          <mesh position-y={45}>
            <boxGeometry args={[30, 90, 10]} />
            <meshStandardMaterial map={bookshelfTexture()} roughness={0.85} />
          </mesh>
        </At>
      ))}
      <ManaShields />
      {[0, 1, 2, 3].map((k) => (
        <SideTable key={k} a={Math.PI / 4 + (k * Math.PI) / 2} r={R + 30} seed={k} />
      ))}
      {[Math.PI / 2 + 0.55, -Math.PI / 2 - 0.55, 0.62, -0.62].map((a, i) => (
        <Candelabra key={i} a={a} r={R + 44} seed={i} />
      ))}
      <SleepingCat a={Math.PI + 0.42} r={84} />
    </group>
  );
}

// --- fireplace ----------------------------------------------------------------------------------

function Fireplace() {
  const stone = tiled(flagstoneTexture([118, 100, 86]), "hearth-stone", [1.6, 1.4]);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    if (glow.current) glow.current.opacity = 0.75 + Math.sin(t * 7) * 0.08 + Math.sin(t * 13) * 0.05;
  });
  return (
    <At a={Math.PI} r={WALL_R - 9}>
      <mesh position-y={28}>
        <boxGeometry args={[66, 56, 16]} />
        <meshStandardMaterial map={stone} roughness={0.95} />
      </mesh>
      <mesh position={[0, 110, 2]}>
        <boxGeometry args={[46, 108, 12]} />
        <meshStandardMaterial map={stone} roughness={0.95} />
      </mesh>
      {/* The firebox: a dark mouth with embers glowing at the back. */}
      <mesh position={[0, 14, -8.05]}>
        <planeGeometry args={[36, 27]} />
        <meshBasicMaterial color="#0a0503" side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 8, -8.1]} rotation-y={Math.PI}>
        <planeGeometry args={[34, 14]} />
        <meshBasicMaterial ref={glow} color="#ff6a1a" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[0, 58, -2]}>
        <boxGeometry args={[76, 4, 22]} />
        <meshStandardMaterial color="#4b2c1b" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.8, -15]}>
        <boxGeometry args={[80, 1.6, 16]} />
        <meshStandardMaterial map={stone} roughness={0.95} />
      </mesh>
      {[
        [0, 0.4],
        [0, -0.4],
        [0.3, 0],
      ].map(([rx, ry], i) => (
        <mesh key={i} position={[0, 3 + i * 1.6, -11]} rotation={[0, ry, Math.PI / 2 + rx]}>
          <cylinderGeometry args={[1.8, 2, 22, 10]} />
          <meshStandardMaterial color="#3a2414" roughness={0.9} emissive="#ff5a10" emissiveIntensity={i === 2 ? 0.15 : 0.08} />
        </mesh>
      ))}
      {[-7, -2.5, 2, 6.5, 0].map((x, i) => (
        <Flame key={i} position={[x, 5 + (i % 2), -12 - (i % 3)]} size={i === 4 ? 13 : 8 + (i % 3) * 1.5} color="#ff8a30" glow={1.8} seed={i * 1.3} />
      ))}
      <FlickerLight position={[0, 16, -26]} color="#ff8a3a" intensity={420} distance={190} decay={1.35} />
      <Motes count={24} box={[-12, 8, -18, 12, 70, -8]} color="#ffb060" size={0.7} rise={9} wander={0.8} seed={2} />
      <Candle position={[-28, 60, -6]} h={4} r={0.7} seed={3} />
      <Candle position={[28, 60, -6]} h={5.5} r={0.7} seed={4} />
      <Tankard position={[16, 60, -7]} />
    </At>
  );
}

function Tankard({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position-y={2.2}>
        <cylinderGeometry args={[1.5, 1.7, 4.4, 14]} />
        <meshStandardMaterial color="#8a8f96" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[1.9, 2.4, 0]}>
        <torusGeometry args={[1.1, 0.3, 8, 16, Math.PI]} />
        <meshStandardMaterial color="#8a8f96" metalness={0.7} roughness={0.35} />
      </mesh>
    </group>
  );
}

// --- bar, barrels, window, shelves ----------------------------------------------------------------

function Bar() {
  const bottles = useMemo(() => {
    const rand = seeded(12);
    const items: ScatterItem[] = [];
    const colors = ["#2f5a2a", "#6b3a16", "#24324a", "#7a1f2a", "#a08a40"];
    for (const y of [58, 76])
      for (let x = -36; x <= 36; x += 3.4 + rand() * 2) items.push({ p: [x, y + 4, 9], s: [1, 0.8 + rand() * 0.5, 1], color: colors[Math.floor(rand() * colors.length)] });
    for (let i = 0; i < 6; i++) items.push({ p: [-30 + i * 11 + rand() * 4, 46, -2 + rand() * 3], s: [1, 0.9 + rand() * 0.3, 1], color: colors[Math.floor(rand() * colors.length)] });
    return items;
  }, []);
  const bottleGeo = useMemo(() => {
    const g = new THREE.LatheGeometry(
      [
        [0.01, 0],
        [1.3, 0],
        [1.3, 5],
        [0.5, 6.6],
        [0.45, 8.6],
        [0.01, 8.6],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      10,
    );
    g.translate(0, -4, 0);
    return g;
  }, []);
  const bottleMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 }), []);
  return (
    <At a={Math.PI / 2} r={WALL_R - 26}>
      <mesh position-y={20}>
        <boxGeometry args={[84, 40, 14]} />
        <meshStandardMaterial map={tiled(woodTexture("walnut"), "bar-front", [2, 1])} roughness={0.55} />
      </mesh>
      <mesh position-y={41}>
        <boxGeometry args={[88, 2.4, 19]} />
        <meshStandardMaterial color="#5b3720" roughness={0.35} metalness={0.05} />
      </mesh>
      {[58, 76].map((y) => (
        <mesh key={y} position={[0, y, 10]}>
          <boxGeometry args={[80, 1.6, 7]} />
          <meshStandardMaterial color="#4b2c1b" roughness={0.6} />
        </mesh>
      ))}
      <Scatter geometry={bottleGeo} material={bottleMat} items={bottles} />
      {[-27, -9, 9, 27].map((x) => (
        <group key={x} position={[x, 0, -16]}>
          <mesh position-y={13}>
            <cylinderGeometry args={[1.1, 1.6, 26, 8]} />
            <meshStandardMaterial color="#3a2414" roughness={0.6} />
          </mesh>
          <mesh position-y={26.5}>
            <cylinderGeometry args={[6, 6, 2, 18]} />
            <meshStandardMaterial color="#5a1f1c" roughness={0.85} />
          </mesh>
        </group>
      ))}
    </At>
  );
}

function barrelGeometry() {
  return new THREE.LatheGeometry(
    [
      [0.01, 0],
      [8, 0],
      [9.3, 4],
      [9.9, 11],
      [9.3, 18],
      [8, 22],
      [0.01, 22],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    18,
  );
}

function Barrel({ position, rotation }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  const geo = useMemo(barrelGeometry, []);
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={geo}>
        <meshStandardMaterial map={tiled(woodTexture("oak"), "barrel", [3, 0.35])} color="#b0906e" roughness={0.7} />
      </mesh>
      {[3.2, 18.8].map((y) => (
        <mesh key={y} position-y={y} rotation-x={FLAT}>
          <torusGeometry args={[9.25, 0.35, 6, 28]} />
          <meshStandardMaterial color="#2c2b2e" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function BarrelStack() {
  const crate = tiled(woodTexture("oak"), "crate", [0.5, 0.5]);
  return (
    <At a={-Math.PI / 2} r={WALL_R - 22}>
      <Barrel position={[-12, 0, 0]} />
      <Barrel position={[8, 0, 0]} />
      <Barrel position={[-2, 22, 2]} />
      <Barrel position={[30, 10, -6]} rotation={[0, 0.3, Math.PI / 2]} />
      {[
        [-36, 7, -4, 14, 0.2],
        [-34, 21, -3, 12, 0.6],
        [44, 6, 4, 12, -0.3],
      ].map(([x, y, z, s, r], i) => (
        <mesh key={i} position={[x, y, z]} rotation-y={r}>
          <boxGeometry args={[s, s, s]} />
          <meshStandardMaterial map={crate} color="#c2a07a" roughness={0.8} />
        </mesh>
      ))}
    </At>
  );
}

function Window() {
  return (
    <At a={0} r={WALL_R - 1}>
      <mesh position-y={78}>
        <planeGeometry args={[40, 56]} />
        <meshBasicMaterial color="#2f4a78" side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 78, -0.6]} rotation-y={Math.PI}>
        <planeGeometry args={[40, 56]} />
        <meshBasicMaterial color="#6f90c8" transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Mullions and frame. */}
      {[
        [0, 78, 2.2, 58],
        [0, 78, 42, 2.2],
        [-20, 78, 2.6, 58],
        [20, 78, 2.6, 58],
        [0, 107, 44, 3],
        [0, 49, 46, 4],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, -1.2]}>
          <boxGeometry args={[w, h, 2.4]} />
          <meshStandardMaterial color="#3a2516" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 17, -10]}>
        <boxGeometry args={[60, 3, 14]} />
        <meshStandardMaterial color="#5b3720" roughness={0.55} />
      </mesh>
      {[-26, 26].map((x) => (
        <mesh key={x} position={[x, 8, -10]}>
          <boxGeometry args={[3, 16, 12]} />
          <meshStandardMaterial color="#4b2c1b" roughness={0.6} />
        </mesh>
      ))}
      <Motes count={30} box={[-22, 10, -40, 22, 70, -4]} color="#9fb8ff" size={0.45} wander={1.4} seed={9} />
    </At>
  );
}

/** Five round shields high on the walls, painted white, blue, black, red and green. */
function ManaShields() {
  const colors = ["#e9e2c8", "#2f6fb0", "#2a2430", "#b0352a", "#2f7a3c"];
  const angles = [Math.PI - 1.15, Math.PI + 1.15, -0.95, 0.95, Math.PI / 2 + 0.75];
  return (
    <>
      {colors.map((c, i) => (
        <At key={c} a={angles[i]} r={WALL_R - 2} y={98}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[9, 9, 1.4, 28]} />
            <meshStandardMaterial color={c} roughness={0.55} />
          </mesh>
          <mesh>
            <torusGeometry args={[9, 0.7, 8, 32]} />
            <meshStandardMaterial color="#b08a48" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position-z={-0.7} rotation-x={-Math.PI / 2}>
            <sphereGeometry args={[2.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#b08a48" metalness={0.8} roughness={0.35} />
          </mesh>
        </At>
      ))}
    </>
  );
}

// --- close to the table ---------------------------------------------------------------------------

function SideTable({ a, r, seed }: { a: number; r: number; seed: number }) {
  return (
    <At a={a} r={r}>
      <mesh position-y={13}>
        <cylinderGeometry args={[1.2, 1.8, 26, 10]} />
        <meshStandardMaterial color="#4b2c1b" roughness={0.55} />
      </mesh>
      <mesh position-y={0.6}>
        <cylinderGeometry args={[5, 5.5, 1.2, 18]} />
        <meshStandardMaterial color="#3e2416" roughness={0.6} />
      </mesh>
      <mesh position-y={26.6}>
        <cylinderGeometry args={[7, 7, 1.2, 24]} />
        <meshStandardMaterial map={tiled(woodTexture("walnut"), "side-table", [0.2, 0.2])} roughness={0.5} />
      </mesh>
      <Candle position={[-2.5, 27.2, 1]} h={2.4 + (seed % 2)} r={0.6} seed={seed + 10} />
      <Tankard position={[2.6, 27.2, -1.2]} />
    </At>
  );
}

function Candelabra({ a, r, seed }: { a: number; r: number; seed: number }) {
  const iron = <meshStandardMaterial color="#26252a" metalness={0.6} roughness={0.5} />;
  return (
    <At a={a} r={r}>
      <mesh position-y={1}>
        <cylinderGeometry args={[4, 5, 2, 12]} />
        {iron}
      </mesh>
      <mesh position-y={26}>
        <cylinderGeometry args={[0.6, 0.8, 50, 8]} />
        {iron}
      </mesh>
      <mesh position-y={50} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.45, 0.45, 13, 6]} />
        {iron}
      </mesh>
      {[-6, 0, 6].map((x, i) => (
        <group key={x}>
          <mesh position={[x, 50.4 + (i === 1 ? 2 : 0), 0]}>
            <cylinderGeometry args={[1.2, 0.8, 0.8, 10]} />
            {iron}
          </mesh>
          <Candle position={[x, 50.8 + (i === 1 ? 2 : 0), 0]} h={3 + ((seed + i) % 3)} r={0.55} seed={seed * 3 + i} />
        </group>
      ))}
    </At>
  );
}

/** A ginger cat curled on a cushion, breathing slowly, its tail tip twitching now and then. */
function SleepingCat({ a, r }: { a: number; r: number }) {
  const body = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const ear = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    const breath = Math.sin(t * 1.6);
    if (body.current) body.current.scale.set(1 + breath * 0.025, 1 + breath * 0.045, 1 + breath * 0.02);
    // The tail tip flicks for a moment every few seconds.
    const cycle = t % 6.5;
    if (tail.current) tail.current.rotation.y = cycle < 0.9 ? Math.sin(cycle * Math.PI * 4.4) * 0.35 : 0;
    const twitch = (t + 2.2) % 9;
    if (ear.current) ear.current.rotation.z = -0.35 + (twitch < 0.25 ? Math.sin(twitch * Math.PI * 8) * 0.25 : 0);
  });
  const fur = <meshStandardMaterial color="#c8742f" roughness={0.95} />;
  return (
    <At a={a} r={r}>
      <group rotation-y={0.6}>
        <mesh position-y={1.4} scale={[1, 0.28, 1]}>
          <cylinderGeometry args={[9, 9.5, 5, 24]} />
          <meshStandardMaterial color="#7a2a26" roughness={0.9} />
        </mesh>
        <group ref={body} position-y={2.6}>
          <mesh position-y={2.4} scale={[1.25, 0.62, 1]}>
            <sphereGeometry args={[5, 20, 14]} />
            {fur}
          </mesh>
          <mesh position={[-4.4, 3.4, -2.6]} scale={[1, 0.86, 0.95]}>
            <sphereGeometry args={[2.7, 16, 12]} />
            {fur}
          </mesh>
          <mesh position={[-5.6, 5.6, -3.6]} rotation-z={0.35}>
            <coneGeometry args={[0.9, 1.8, 4]} />
            {fur}
          </mesh>
          <mesh ref={ear} position={[-3.4, 5.6, -4.1]} rotation-z={-0.35}>
            <coneGeometry args={[0.9, 1.8, 4]} />
            {fur}
          </mesh>
          {/* Darker stripes. */}
          {[-1.5, 1, 3.4].map((x) => (
            <mesh key={x} position={[x, 4.9, 0]} rotation-x={Math.PI / 2} scale={[1, 1, 0.3]}>
              <torusGeometry args={[2.6, 0.45, 6, 12, Math.PI]} />
              <meshStandardMaterial color="#9a5422" roughness={0.95} />
            </mesh>
          ))}
          <group position={[5.6, 1.6, 1.2]} rotation-y={-0.6}>
            <mesh position={[0, 0, 2.4]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.9, 1.1, 5, 8]} />
              {fur}
            </mesh>
            <group ref={tail} position={[0, 0, 4.8]}>
              <mesh position={[-1.6, 0, 1]} rotation={[Math.PI / 2, 0, -1]}>
                <cylinderGeometry args={[0.7, 0.9, 4, 8]} />
                <meshStandardMaterial color="#9a5422" roughness={0.95} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </At>
  );
}
