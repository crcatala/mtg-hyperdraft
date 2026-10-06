// The three tables players can sit at (shared/scene.ts). Each is drawn around the same round play area
// (tableRadius): its felt, slate or leather inlay is exactly that disc and carries the table's pointer handlers
// (pan, deselect, "Ping here"), so switching tables never moves or changes anything that's played on it.
// The top sits at y = 0 like before; legs and chairs reach down to the floor, a table's height below.

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TableStyleId } from "../../shared/scene";
import { seatAngle } from "../../shared/tableLayout";
import { feltTexture, leatherTexture, runeRingTexture, slateTexture, tiled, woodTexture } from "./sceneTextures";
import { Candle, CandleBatch, FLOOR_Y, around, sceneTime } from "./bits";
import { glowTexture } from "../table/textures";

const FLAT = -Math.PI / 2;

/** The play surface's pointer handlers, passed through from the table scene. */
export type SurfaceHandlers = Pick<ThreeElements["mesh"], "onPointerDown" | "onContextMenu">;

interface TableProps {
  radius: number;
  seatCount: number;
  surface?: SurfaceHandlers;
}

export function TableModel({ style, ...props }: TableProps & { style: TableStyleId }) {
  return <CandleBatch>{style === "runestone" ? <RunestoneTable {...props} /> : style === "oak" ? <OakTable {...props} /> : <FeltTable {...props} />}</CandleBatch>;
}

/** How far a table reaches from its centre at its widest along a seat's line (where the chairs go). */
export function tableReach(style: TableStyleId, radius: number): number {
  return style === "runestone" ? radius + RUNE_BAND : style === "oak" ? radius + OAK_BORDER : radius + FELT_RAIL;
}

// --- classic felt -----------------------------------------------------------------------------

const FELT_RAIL = 2.8;

function FeltTable({ radius: R, seatCount, surface }: TableProps) {
  const felt = feltTexture("#24694f", "#0e3326");
  const apron = tiled(woodTexture("walnut"), "walnut-apron", [7, 0.18]);
  const top = tiled(woodTexture("walnut"), "walnut-top", [0.08, 0.08]);
  const pedestal = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          [0.1, 0],
          [10, 0],
          [10, 1.4],
          [7, 2.6],
          [4.6, 4.2],
          [3.6, 9],
          [4.6, 12.5],
          [3.3, 16],
          [3.6, 21],
          [5.2, 23.6],
          [7, 25.6],
          [0.1, 25.6],
        ].map(([x, y]) => new THREE.Vector2(x, y)),
        40,
      ),
    [],
  );
  return (
    <group>
      <mesh rotation-x={FLAT} position-y={-0.02} {...surface}>
        <circleGeometry args={[R, 128]} />
        <meshStandardMaterial map={felt} roughness={1} />
      </mesh>
      {/* Brass bead between the felt and the rail. */}
      <mesh rotation-x={FLAT} position-y={-0.012}>
        <ringGeometry args={[R, R + 0.32, 128]} />
        <meshStandardMaterial color="#c49a52" metalness={0.85} roughness={0.32} />
      </mesh>
      {/* Padded leather rail. */}
      <mesh rotation-x={FLAT} position-y={0.28} scale={[1, 1, 0.6]}>
        <torusGeometry args={[R + 1.55, 1.25, 18, 160]} />
        <meshStandardMaterial color="#3d2418" roughness={0.42} metalness={0.05} />
      </mesh>
      <mesh rotation-x={FLAT} position-y={-0.1}>
        <ringGeometry args={[R + 0.3, R + FELT_RAIL, 128]} />
        <meshStandardMaterial map={top} roughness={0.5} />
      </mesh>
      <mesh position-y={-1.85}>
        <cylinderGeometry args={[R + FELT_RAIL, R + FELT_RAIL - 0.4, 3.5, 128, 1, true]} />
        <meshStandardMaterial map={apron} roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-FLAT} position-y={-3.6}>
        <circleGeometry args={[R + FELT_RAIL - 0.4, 64]} />
        <meshStandardMaterial color="#1a0f08" roughness={0.9} />
      </mesh>
      <mesh geometry={pedestal} position-y={FLOOR_Y}>
        <meshStandardMaterial color="#4b2c1b" roughness={0.45} metalness={0.05} />
      </mesh>
      <Chairs seatCount={seatCount} distance={R + FELT_RAIL + 6} kind="classic" />
    </group>
  );
}

// --- runestone --------------------------------------------------------------------------------

/** How far the slab reaches past the play area (to the middle of its flat sides). */
const RUNE_BAND = 3.8;

function RunestoneTable({ radius: R, seatCount, surface }: TableProps) {
  // Twelve sides: a flat side faces every seat at any seat count (1-4 seats sit at multiples of 30°).
  const flat = (R + RUNE_BAND) / Math.cos(Math.PI / 12);
  const runes = runeRingTexture((R + 0.45) / (R + 3.35));
  const stone = tiled(slateTexture(), "slate-slab", [4, 0.6]);
  const runeMat = useRef<THREE.MeshStandardMaterial>(null);
  const trimMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock);
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.9);
    if (runeMat.current) runeMat.current.emissiveIntensity = 0.75 + pulse * 0.55;
    if (trimMat.current) trimMat.current.emissiveIntensity = 0.9 + pulse * 0.6;
  });
  // Floating crystals halfway between seats, so they're never in front of anyone.
  const crystals = useMemo(() => {
    const n = Math.max(2, seatCount);
    const count = seatCount <= 1 ? 4 : n;
    return Array.from({ length: count }, (_, i) => (seatCount <= 1 ? Math.PI / 4 + (i * Math.PI) / 2 : seatAngle(i, n) + Math.PI / n));
  }, [seatCount]);
  return (
    <group>
      <mesh rotation-x={FLAT} position-y={-0.02} {...surface}>
        <circleGeometry args={[R, 128]} />
        <meshStandardMaterial map={slateTexture()} roughness={0.75} metalness={0.05} />
      </mesh>
      <mesh rotation-x={FLAT} position-y={-0.015}>
        <ringGeometry args={[R, R + 0.2, 128]} />
        <meshStandardMaterial ref={trimMat} color="#2a2340" emissive="#a68cff" emissiveIntensity={1.2} roughness={0.4} />
      </mesh>
      <mesh rotation-x={FLAT} position-y={-0.025}>
        <ringGeometry args={[R + 0.45, R + 3.35, 160]} />
        <meshStandardMaterial ref={runeMat} color="#22252e" emissive="#8f6bff" emissiveMap={runes} emissiveIntensity={1} roughness={0.8} />
      </mesh>
      <mesh position-y={-1.8} rotation-y={Math.PI / 12}>
        <cylinderGeometry args={[flat, flat * 0.98, 3.5, 12]} />
        <meshStandardMaterial map={stone} color="#8a90a2" roughness={0.85} flatShading />
      </mesh>
      <mesh position-y={-4.25} rotation-y={Math.PI / 12}>
        <cylinderGeometry args={[flat * 0.92, flat * 0.88, 1.4, 12]} />
        <meshStandardMaterial map={stone} color="#6d7282" roughness={0.9} flatShading />
      </mesh>
      <mesh position-y={(FLOOR_Y + 3 - 4.95) / 2} rotation-y={Math.PI / 12}>
        <cylinderGeometry args={[6.2, 7.4, -4.95 - FLOOR_Y - 3, 12]} />
        <meshStandardMaterial map={stone} color="#727889" roughness={0.9} flatShading />
      </mesh>
      <mesh position-y={FLOOR_Y + 1.5} rotation-y={Math.PI / 12}>
        <cylinderGeometry args={[12, 13.5, 3, 12]} />
        <meshStandardMaterial map={stone} color="#646a7a" roughness={0.9} flatShading />
      </mesh>
      {crystals.map((a, i) => (
        <Crystal key={i} angle={a} r={R + 1.9} seed={i} />
      ))}
      <Chairs seatCount={seatCount} distance={R + RUNE_BAND + 6} kind="throne" />
    </group>
  );
}

function Crystal({ angle, r, seed }: { angle: number; r: number; seed: number }) {
  const body = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.SpriteMaterial>(null);
  const [x, z] = around(angle, r);
  useFrame(({ clock }) => {
    const t = sceneTime(clock) + seed * 1.7;
    if (body.current) {
      body.current.position.y = 3.4 + Math.sin(t * 1.1) * 0.35;
      body.current.rotation.y = t * 0.5;
    }
    if (halo.current) halo.current.opacity = 0.35 + Math.sin(t * 1.1) * 0.1;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh ref={body} position-y={3.4} scale={[1, 1.9, 1]}>
        <octahedronGeometry args={[0.75, 0]} />
        <meshStandardMaterial color="#c6b4ff" emissive="#7b55ff" emissiveIntensity={1.1} roughness={0.15} metalness={0.1} flatShading />
      </mesh>
      <sprite position-y={3.4} scale={[4, 4, 1]}>
        <spriteMaterial ref={halo} map={glowTexture()} color="#9f84ff" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      {/* Its light pooled on the runes below. */}
      <mesh rotation-x={FLAT} position-y={0.01}>
        <circleGeometry args={[2.2, 24]} />
        <meshBasicMaterial map={glowTexture()} color="#8f6bff" transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

// --- oak & brass ------------------------------------------------------------------------------

/** How far the square top reaches past the play area, to the middle of each side. */
const OAK_BORDER = 3.4;
const OAK_THICK = 2.6;
const OAK_BEVEL = 0.5;

function OakTable({ radius: R, seatCount, surface }: TableProps) {
  const half = R + OAK_BORDER;
  const top = useMemo(() => {
    const s = new THREE.Shape();
    const c = 7;
    s.moveTo(-half + c, -half);
    s.lineTo(half - c, -half);
    s.quadraticCurveTo(half, -half, half, -half + c);
    s.lineTo(half, half - c);
    s.quadraticCurveTo(half, half, half - c, half);
    s.lineTo(-half + c, half);
    s.quadraticCurveTo(-half, half, -half, half - c);
    s.lineTo(-half, -half + c);
    s.quadraticCurveTo(-half, -half, -half + c, -half);
    return new THREE.ExtrudeGeometry(s, { depth: OAK_THICK, bevelEnabled: true, bevelThickness: OAK_BEVEL, bevelSize: OAK_BEVEL, bevelSegments: 3, curveSegments: 10 });
  }, [half]);
  const leg = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          [0.1, 0],
          [1.6, 0],
          [1.9, 1.2],
          [1.4, 3],
          [1.3, 9],
          [2.1, 12],
          [1.5, 15],
          [1.6, 19],
          [2.3, 21],
          [2.3, 25.5],
          [0.1, 25.5],
        ].map(([x, y]) => new THREE.Vector2(x, y)),
        20,
      ),
    [],
  );
  const wood = woodTexture("oak", [1 / 26, 1 / 26]);
  const underside = -OAK_THICK - OAK_BEVEL * 2 - 0.04;
  const legAt = half - 4.5;
  const corner = half - 4.4;
  return (
    <group>
      <mesh rotation-x={FLAT} position-y={-0.02} {...surface}>
        <circleGeometry args={[R, 128]} />
        <meshStandardMaterial map={leatherTexture()} roughness={0.55} />
      </mesh>
      <mesh rotation-x={FLAT} position-y={-0.012}>
        <ringGeometry args={[R, R + 0.42, 128]} />
        <meshStandardMaterial color="#c9a157" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh geometry={top} rotation-x={FLAT} position-y={underside + OAK_BEVEL}>
        <meshStandardMaterial map={wood} roughness={0.5} metalness={0.04} />
      </mesh>
      {/* Aprons between the legs. */}
      {[0, 1, 2, 3].map((k) => {
        const [x, z] = rotXZ(0, legAt, (k * Math.PI) / 2);
        return (
          <mesh key={k} rotation-y={(k * Math.PI) / 2} position={[x, underside - 1.8, z]}>
            <boxGeometry args={[legAt * 2, 3.6, 1.2]} />
            <meshStandardMaterial color="#6b4524" roughness={0.6} />
          </mesh>
        );
      })}
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([sx, sz], i) => (
        <group key={i}>
          <mesh geometry={leg} position={[sx * legAt, FLOOR_Y, sz * legAt]}>
            <meshStandardMaterial color="#6b4524" roughness={0.5} />
          </mesh>
          {/* A brass candle dish in each corner, outside the play area. */}
          <group position={[sx * corner, 0, sz * corner]}>
            <mesh position-y={0.18}>
              <cylinderGeometry args={[1.5, 1.7, 0.36, 24]} />
              <meshStandardMaterial color="#c9a157" metalness={0.85} roughness={0.3} />
            </mesh>
            <Candle position={[0, 0.36, 0]} h={2.6 + (i % 2) * 1.2} r={0.55} seed={i} />
          </group>
        </group>
      ))}
      <Chairs seatCount={seatCount} distance={half + 6} kind="ladder" />
    </group>
  );
}

/** Table point (x, z) turned by `a` around the centre, as [x, z]. */
function rotXZ(x: number, z: number, a: number): [number, number] {
  return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
}

// --- chairs -----------------------------------------------------------------------------------

type ChairKind = "classic" | "throne" | "ladder";
type ChairMat = "frame" | "cushion" | "glow";

interface ChairPart {
  geo: THREE.BufferGeometry;
  p: [number, number, number];
  r?: [number, number, number];
  m: ChairMat;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A chair on the floor at the origin, its seat facing -z (the table). Sizes in inches. */
function chairParts(kind: ChairKind): ChairPart[] {
  if (kind === "throne") {
    // A carved stone seat with a tall arched back and a violet cushion; one rune glows near the top.
    return [
      { geo: box(18, 17, 17), p: [0, 8.5, 0], m: "frame" },
      { geo: box(15.5, 1.8, 14.5), p: [0, 17.9, -0.5], m: "cushion" },
      { geo: box(17, 26, 3), p: [0, 30, 7.5], m: "frame" },
      { geo: new THREE.CylinderGeometry(8.5, 8.5, 3, 16, 1, false, Math.PI / 2, Math.PI), p: [0, 43, 7.5], r: [Math.PI / 2, 0, 0], m: "frame" },
      { geo: box(2, 7, 15), p: [-8.4, 22, -1], m: "frame" },
      { geo: box(2, 7, 15), p: [8.4, 22, -1], m: "frame" },
      { geo: new THREE.CircleGeometry(1.8, 6), p: [0, 41, 5.9], r: [0, Math.PI, 0], m: "glow" },
    ];
  }
  const parts: ChairPart[] = [
    ...[
      [7.2, -6.6],
      [-7.2, -6.6],
      [7.2, 6.6],
      [-7.2, 6.6],
    ].map(([x, z]): ChairPart => ({ geo: box(1.6, 17, 1.6), p: [x, 8.5, z], m: "frame" })),
    { geo: box(17, 1.4, 16), p: [0, 17.6, 0], m: "frame" },
    { geo: box(15.4, 1.6, 14.4), p: [0, 19, -0.4], m: "cushion" },
    { geo: box(1.7, 21, 1.7), p: [7.2, 28.5, 6.8], m: "frame" },
    { geo: box(1.7, 21, 1.7), p: [-7.2, 28.5, 6.8], m: "frame" },
  ];
  if (kind === "ladder") for (const y of [23.5, 28.5, 33.5, 38]) parts.push({ geo: box(13, 1.8, 0.9), p: [0, y, 6.9], m: "frame" });
  else parts.push({ geo: box(12.8, 13, 1.4), p: [0, 29, 6.9], m: "cushion" }, { geo: box(17.4, 2.2, 2.2), p: [0, 38.6, 6.8], m: "frame" });
  return parts;
}

const CHAIR_LOOK: Record<ChairKind, Record<ChairMat, THREE.MeshStandardMaterialParameters>> = {
  classic: { frame: { color: "#4b2c1b", roughness: 0.55 }, cushion: { color: "#1f4a3a", roughness: 0.9 }, glow: {} },
  ladder: { frame: { color: "#6b4524", roughness: 0.55 }, cushion: { color: "#5a1f1c", roughness: 0.9 }, glow: {} },
  throne: {
    frame: { color: "#3e4350", roughness: 0.9, flatShading: true },
    cushion: { color: "#4b2f7a", roughness: 0.85 },
    glow: { color: "#2a1f45", emissive: "#8f6bff", emissiveIntensity: 1.4 },
  },
};

/**
 * One chair behind each seat, facing the table. Each kind of chair is merged into one mesh per material and
 * instanced across the seats, so all the chairs together are two or three draw calls.
 */
function Chairs({ seatCount, distance, kind }: { seatCount: number; distance: number; kind: ChairKind }) {
  const groups = useMemo(() => {
    const parts = chairParts(kind);
    const m = new THREE.Matrix4();
    const out: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[] = [];
    for (const mat of ["frame", "cushion", "glow"] as ChairMat[]) {
      const mine = parts.filter((p) => p.m === mat);
      if (!mine.length) continue;
      const geos = mine.map((p) => p.geo.applyMatrix4(m.compose(new THREE.Vector3(...p.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.r ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1))));
      const geo = mergeGeometries(geos.map((g) => g.toNonIndexed()));
      geos.forEach((g) => g.dispose());
      out.push({ geo, mat: new THREE.MeshStandardMaterial(CHAIR_LOOK[kind][mat]) });
    }
    return out;
  }, [kind]);
  useEffect(
    () => () => {
      for (const g of groups) {
        g.geo.dispose();
        g.mat.dispose();
      }
    },
    [groups],
  );
  const n = Math.max(1, seatCount);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (const mesh of refs.current) {
      if (!mesh) continue;
      for (let seat = 0; seat < n; seat++) {
        const a = seatAngle(seat, n);
        const [x, z] = around(a, distance);
        mesh.setMatrixAt(seat, m.compose(new THREE.Vector3(x, FLOOR_Y, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), one));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [groups, n, distance]);
  return (
    <>
      {groups.map((g, i) => (
        <instancedMesh key={`${kind}-${i}-${n}`} ref={(el) => void (refs.current[i] = el)} args={[g.geo, g.mat, n]} />
      ))}
    </>
  );
}
