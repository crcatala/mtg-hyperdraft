// /dev/scene-lab: look at every table and environment (shared/scene.ts) at 1-4 seats, with stand-in mats, from a
// player's seat (the game's own camera, or as far out as the wheel zooms), from overhead, orbiting freely, or with
// the title screen's camera; draw calls and frame rate underneath. Linked from the debug console.
// ?table=&env=&seats=&cam=seat|far|overview|orbit|title preset the view (handy for screenshots); for profiling,
// ?hide=sprites,points,transparent,env,lights hides kinds of objects and ?bare=1 leaves the environment out.

import { useEffect, useMemo, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as THREE from "three";
import { Icon } from "../components/Icon";
import { navigate } from "../router";
import { ENVIRONMENTS, TABLE_STYLES, isEnvironment, isTableStyle, type EnvironmentId, type TableStyleId } from "../../shared/scene";
import { CARD_H, CARD_W, MAT_D, MAT_W, localToTable, seatAngle, tableRadius } from "../../shared/tableLayout";
import { Environment } from "../scene/Environment";
import { TableModel } from "../scene/tables";
import { backTexture, matTexture } from "../table/textures";
import { homePose, posePosition, seatHue } from "../table/TableScene";
import { TitleCamera } from "../scene/TitleBackdrop";

const CAMS = ["seat", "far", "overview", "orbit", "title"] as const;
type Cam = (typeof CAMS)[number];
const CAM_LABELS: Record<Cam, string> = { seat: "Your seat", far: "Zoomed out", overview: "Overview", orbit: "Orbit", title: "Title screen" };

export function SceneLab() {
  const q = new URLSearchParams(location.search);
  const [table, setTable] = useState<TableStyleId>(() => (isTableStyle(q.get("table")) ? (q.get("table") as TableStyleId) : TABLE_STYLES[0].id));
  const [env, setEnv] = useState<EnvironmentId>(() => (isEnvironment(q.get("env")) ? (q.get("env") as EnvironmentId) : ENVIRONMENTS[0].id));
  const [seats, setSeats] = useState(() => Math.min(4, Math.max(1, Number(q.get("seats")) || 4)));
  const [cam, setCam] = useState<Cam>(() => (CAMS.includes(q.get("cam") as Cam) ? (q.get("cam") as Cam) : "seat"));
  const [stats, setStats] = useState("");

  return (
    <div className="screen scene-lab">
      <Canvas className="table-canvas" dpr={[1, 2]} camera={{ fov: 42, near: 0.5, far: 1200, position: [0, 30, 30] }} gl={{ antialias: true }}>
        {q.get("bare") ? <ambientLight intensity={1.2} /> : <Environment id={env} radius={tableRadius(seats)} />}
        <TableModel style={table} radius={tableRadius(seats)} seatCount={seats} />
        {Array.from({ length: seats }, (_, s) => (
          <StandInMat key={s} seat={s} seatCount={seats} />
        ))}
        <Stats onStats={setStats} />
        {q.get("hide") && <Hide what={q.get("hide")!.split(",")} />}
        {cam === "orbit" ? <Orbit /> : cam === "title" ? <TitleCamera radius={tableRadius(seats)} /> : <FixedCamera seats={seats} mode={cam === "overview" ? "overview" : cam === "far" ? "far" : "seat"} />}
      </Canvas>
      <div className="scene-lab-panel panel">
        <button className="btn ghost small" onClick={() => navigate("/")}>
          <Icon name="arrow-left" /> Home
        </button>
        <h2>Scene Lab</h2>
        <Row label="Table" options={TABLE_STYLES.map((t) => [t.id, t.label])} value={table} onPick={(v) => setTable(v as TableStyleId)} />
        <Row label="Environment" options={ENVIRONMENTS.map((e) => [e.id, e.label])} value={env} onPick={(v) => setEnv(v as EnvironmentId)} />
        <Row label="Seats" options={[1, 2, 3, 4].map((n) => [String(n), String(n)])} value={String(seats)} onPick={(v) => setSeats(Number(v))} />
        <Row label="Camera" options={CAMS.map((c) => [c, CAM_LABELS[c]])} value={cam} onPick={(v) => setCam(v as Cam)} />
        <p className="faint scene-lab-stats">{stats}</p>
      </div>
    </div>
  );
}

function Row({ label, options, value, onPick }: { label: string; options: [string, string][]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="scene-lab-row" role="group" aria-label={label}>
      <span className="faint">{label}</span>
      <div className="scene-lab-opts">
        {options.map(([id, text]) => (
          <button key={id} className="btn small" aria-pressed={value === id} onClick={() => onPick(id)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Profiling: hides kinds of objects (?hide=sprites,points,transparent,env,lights) to see what costs what. */
function Hide({ what }: { what: string[] }) {
  const { scene } = useThree();
  useFrame(() => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (what.includes("sprites") && (o as THREE.Sprite).isSprite) o.visible = false;
      if (what.includes("points") && (o as THREE.Points).isPoints) o.visible = false;
      if (what.includes("transparent") && m?.transparent && !(o as THREE.Sprite).isSprite && o.renderOrder !== 1) o.visible = false;
      if (what.includes("env") && o.renderOrder === 5) o.visible = false;
      if (what.includes("lights") && (o as THREE.PointLight).isPointLight) o.visible = false;
    });
  });
  return null;
}

/** Draw calls, triangles and frame rate, refreshed every second (to keep the environments cheap). */
function Stats({ onStats }: { onStats: (s: string) => void }) {
  const { gl } = useThree();
  const frames = useMemo(() => ({ n: 0, since: performance.now() }), []);
  useFrame(() => {
    frames.n++;
    const now = performance.now();
    if (now - frames.since < 1000) return;
    const { calls, triangles } = gl.info.render;
    onStats(`${calls} draw calls · ${(triangles / 1000).toFixed(1)}k triangles · ${Math.round((frames.n * 1000) / (now - frames.since))} fps`);
    frames.n = 0;
    frames.since = now;
  });
  return null;
}

/** Drag to orbit, wheel to zoom, right-drag to pan (three's OrbitControls). */
function Orbit() {
  const { camera, gl } = useThree();
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);
  useEffect(() => {
    controls.maxDistance = 500;
    controls.enableDamping = true;
    return () => controls.dispose();
  }, [controls]);
  useFrame(() => controls.update());
  return null;
}

/** The game's camera: behind seat 0 (as far out as the wheel goes, with "far"), or overhead; still. */
function FixedCamera({ seats, mode }: { seats: number; mode: "seat" | "far" | "overview" }) {
  const { camera } = useThree();
  const pose = useMemo(() => {
    const home = homePose(0, seats);
    if (mode === "overview") return { target: new THREE.Vector3(), az: home.az, polar: 0.12, dist: tableRadius(seats) * 2.6 };
    return mode === "far" ? { ...home, dist: 120 } : home;
  }, [seats, mode]);
  useEffect(() => {
    posePosition(pose, camera.position);
    camera.lookAt(pose.target);
  }, [camera, pose]);
  useFrame(() => camera.lookAt(pose.target));
  return null;
}

/** A player's mat with a few cards on it, to judge how a table frames the play area. */
function StandInMat({ seat, seatCount }: { seat: number; seatCount: number }) {
  const tex = useMemo(() => matTexture(seat === 0 ? "You" : `Player ${seat + 1}`, seatHue(seat), seat === 0, null), [seat]);
  const c = localToTable({ x: 0, y: 0 }, seat, seatCount);
  const angle = seatAngle(seat, seatCount);
  return (
    <group position={[c.x, 0, c.y]} rotation-y={-angle}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={1}>
        <planeGeometry args={[MAT_W, MAT_D]} />
        <meshStandardMaterial map={tex} transparent roughness={0.9} depthWrite={false} />
      </mesh>
      {[-6, -3.2, -0.4, 2.4].map((x, i) => (
        <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.03 + i * 0.004, -1]}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshStandardMaterial map={backTexture()} roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}
