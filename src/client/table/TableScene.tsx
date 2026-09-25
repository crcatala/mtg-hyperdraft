// The 3D tabletop: felt table, one mat per seat, piles, battlefield cards and other players' hands.

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";
import type { TableCard, TableState } from "../../shared/types";
import { CARD_H, CARD_W, MAT_D, MAT_W, localToTable, pilePosition, seatAngle, tableRadius, type PileZone } from "../../shared/tableLayout";
import { backTexture, feltTexture, labelTexture, matTexture, roundedRectGeometry, useCardTexture, type LabelVariant } from "./textures";
import { battlefieldMenu, pileMenu, toggleTap, useTableUi, act } from "./tableUi";
import { beginDrag, tableApi } from "./drag";

const CARD_GEO = roundedRectGeometry(CARD_W, CARD_H, 0.14);
const OUTLINE_GEO = roundedRectGeometry(CARD_W + 0.22, CARD_H + 0.22, 0.24);
const SHADOW_GEO = roundedRectGeometry(CARD_W + 0.3, CARD_H + 0.3, 0.3);
const FLAT = -Math.PI / 2;

export function seatHue(seat: number) {
  return (seat * 67 + 260) % 360;
}

export function TableCanvas() {
  return (
    <Canvas
      className="table-canvas"
      dpr={[1, 2]}
      camera={{ fov: 42, near: 0.5, far: 600, position: [0, 30, 30] }}
      onContextMenu={(e) => e.preventDefault()}
      gl={{ antialias: true }}
    >
      <Scene />
    </Canvas>
  );
}

function Scene() {
  const table = useStore((s) => s.view?.table)!;
  const me = useStore((s) => s.view?.you)!;
  const n = table.seats.length;
  const mySeat = Math.max(0, table.seats.indexOf(me));

  const battlefield = useMemo(() => {
    const list = Object.values(table.cards).filter((c) => c.zone === "battlefield");
    list.sort((a, b) => a.z - b.z);
    return list;
  }, [table.cards]);

  return (
    <>
      <color attach="background" args={["#07060c"]} />
      <fog attach="fog" args={["#07060c", 70, 190]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[12, 40, 18]} intensity={1.4} />
      <hemisphereLight args={["#b9a6ff", "#1a1020", 0.5]} />
      <ScreenApi />
      <CameraRig seat={mySeat} seatCount={n} />
      <TableSurface seatCount={n} />
      {table.seats.map((pid, seat) => (
        <SeatArea key={pid} table={table} playerId={pid} seat={seat} seatCount={n} isMe={pid === me} viewerAngle={seatAngle(mySeat, n)} />
      ))}
      {battlefield.map((card, i) => (
        <BattlefieldCard key={card.id} card={card} elevation={0.03 + i * 0.004} table={table} me={me} />
      ))}
    </>
  );
}

/** Exposes screen → table-plane conversion to DOM code (hand drags, drops). */
function ScreenApi() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    tableApi.screenToTable = (clientX, clientY) => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : null;
    };
    return () => {
      tableApi.screenToTable = () => null;
    };
  }, [camera, gl]);
  return null;
}

// --- camera ---------------------------------------------------------------------------------

function CameraRig({ seat, seatCount }: { seat: number; seatCount: number }) {
  const { camera, gl } = useThree();
  const overview = useTableUi((s) => s.overview);
  const home = useMemo(() => {
    // Aim a little past the near edge of your mat toward the centre so opponents are in view too.
    const solo = seatCount <= 1;
    const c = localToTable({ x: 0, y: solo ? 0.5 : -MAT_D / 2 + 1.5 }, seat, seatCount);
    const toward = localToTable({ x: 0, y: 50 }, seat, seatCount);
    const az = Math.atan2(toward.x - c.x, toward.y - c.y);
    const dist = solo ? 30 : seatCount === 2 ? 44 : seatCount === 3 ? 50 : 56;
    return { target: new THREE.Vector3(c.x, 0, c.y), az, polar: solo ? 0.72 : 0.62, dist };
  }, [seat, seatCount]);
  const rig = useRef({ target: home.target.clone(), az: home.az, polar: home.polar, dist: home.dist });
  const keys = useRef(new Set<string>());
  const curTarget = useRef(home.target.clone());

  useEffect(() => {
    rig.current = { target: home.target.clone(), az: home.az, polar: home.polar, dist: home.dist };
  }, [home]);

  useEffect(() => {
    if (overview) rig.current = { target: new THREE.Vector3(0, 0, 0), az: home.az, polar: 0.12, dist: tableRadius(seatCount) * 2.6 };
    else rig.current = { target: home.target.clone(), az: home.az, polar: home.polar, dist: home.dist };
  }, [overview, home, seatCount]);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest("input, textarea, select");
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      keys.current.add(e.key);
      if (e.key === "Home") rig.current = { target: home.target.clone(), az: home.az, polar: home.polar, dist: home.dist };
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key);
    const blur = () => keys.current.clear();
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement) !== gl.domElement) return;
      e.preventDefault();
      rig.current.dist = THREE.MathUtils.clamp(rig.current.dist * Math.pow(1.0015, e.deltaY), 8, 120);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    gl.domElement.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      gl.domElement.removeEventListener("wheel", wheel);
    };
  }, [gl, home]);

  // Middle-drag (or left-drag on empty table, wired in TableSurface) pans.
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.button === 1) startPan(e);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [gl]);

  useEffect(() => {
    panApi.start = (e) => startPan(e);
  });

  function startPan(e: { clientX: number; clientY: number }) {
    let lastX = e.clientX;
    let lastY = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      const s = rig.current.dist * 0.0016;
      const az = rig.current.az;
      rig.current.target.x += (-dx * Math.cos(az) - dy * Math.sin(az)) * s;
      rig.current.target.z += (dx * Math.sin(az) - dy * Math.cos(az)) * s;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  useFrame((_, dt) => {
    const r = rig.current;
    const k = keys.current;
    const speed = r.dist * 0.9 * dt;
    const fx = -Math.sin(r.az);
    const fz = -Math.cos(r.az);
    if (k.has("ArrowUp")) r.target.add(new THREE.Vector3(fx * speed, 0, fz * speed));
    if (k.has("ArrowDown")) r.target.add(new THREE.Vector3(-fx * speed, 0, -fz * speed));
    if (k.has("ArrowLeft")) r.target.add(new THREE.Vector3(fz * speed, 0, -fx * speed));
    if (k.has("ArrowRight")) r.target.add(new THREE.Vector3(-fz * speed, 0, fx * speed));
    if (k.has("q") || k.has("Q")) r.az += dt * 1.4;
    if (k.has("e") || k.has("E")) r.az -= dt * 1.4;
    const lim = tableRadius(seatCount) + 10;
    r.target.x = THREE.MathUtils.clamp(r.target.x, -lim, lim);
    r.target.z = THREE.MathUtils.clamp(r.target.z, -lim, lim);

    const desired = new THREE.Vector3(
      r.target.x + Math.sin(r.az) * Math.sin(r.polar) * r.dist,
      Math.cos(r.polar) * r.dist,
      r.target.z + Math.cos(r.az) * Math.sin(r.polar) * r.dist,
    );
    const a = 1 - Math.exp(-dt * 8);
    camera.position.lerp(desired, a);
    curTarget.current.lerp(r.target, a);
    camera.lookAt(curTarget.current);
  });

  return null;
}

const panApi: { start: (e: { clientX: number; clientY: number }) => void } = { start: () => {} };

// --- table + mats ---------------------------------------------------------------------------

function TableSurface({ seatCount }: { seatCount: number }) {
  const felt = useMemo(() => feltTexture(), []);
  const radius = tableRadius(seatCount);
  return (
    <group>
      <mesh
        rotation-x={FLAT}
        position-y={-0.02}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (!e.shiftKey) useTableUi.getState().setSelected([]);
          panApi.start(e.nativeEvent);
        }}
      >
        <circleGeometry args={[radius, 96]} />
        <meshStandardMaterial map={felt} roughness={0.95} />
      </mesh>
      <mesh rotation-x={FLAT} position-y={-0.05}>
        <ringGeometry args={[radius, radius + 1.6, 96]} />
        <meshStandardMaterial color="#3b2717" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh rotation-x={FLAT} position-y={-0.3}>
        <circleGeometry args={[radius * 6, 32]} />
        <meshBasicMaterial color="#0a0812" />
      </mesh>
    </group>
  );
}

function SeatArea({ table, playerId, seat, seatCount, isMe, viewerAngle }: { table: TableState; playerId: string; seat: number; seatCount: number; isMe: boolean; viewerAngle: number }) {
  const name = useStore((s) => s.view?.players.find((p) => p.id === playerId)?.name ?? "Player");
  const tex = useMemo(() => matTexture(name, seatHue(seat), isMe), [name, seat, isMe]);
  const center = localToTable({ x: 0, y: 0 }, seat, seatCount);
  const angle = seatAngle(seat, seatCount);
  const player = table.players[playerId];
  const handCount = player?.zones.hand.length ?? 0;

  return (
    <group>
      <mesh rotation={[FLAT, 0, -angle]} position={[center.x, 0, center.y]} renderOrder={1}>
        <planeGeometry args={[MAT_W, MAT_D]} />
        <meshStandardMaterial map={tex} transparent roughness={0.9} depthWrite={false} />
      </mesh>
      {(["library", "graveyard", "exile", "sideboard"] as PileZone[]).map((zone) => (
        <Pile key={zone} table={table} ownerId={playerId} zone={zone} seat={seat} seatCount={seatCount} viewerAngle={viewerAngle} />
      ))}
      {!isMe && handCount > 0 && <OpponentHand count={handCount} seat={seat} seatCount={seatCount} viewerAngle={viewerAngle} />}
    </group>
  );
}

function Pile({ table, ownerId, zone, seat, seatCount, viewerAngle }: { table: TableState; ownerId: string; zone: PileZone; seat: number; seatCount: number; viewerAngle: number }) {
  const ids = table.players[ownerId]?.zones[zone] ?? [];
  const count = ids.length;
  const pos = pilePosition(zone, seat, seatCount);
  const angle = seatAngle(seat, seatCount);
  const topId = zone === "graveyard" || zone === "exile" ? ids[ids.length - 1] : undefined;
  const top = topId ? table.cards[topId] : undefined;
  const cards = useStore((s) => s.cards);
  const topData = top?.cardId ? cards[top.cardId] : undefined;
  const tex = useCardTexture(topData, 0, top?.token);
  const back = useMemo(() => backTexture(), []);
  const height = Math.min(count, 60) * 0.018;
  const setPreview = useStore((s) => s.setPreview);
  const me = useStore((s) => s.view?.you);
  if (count === 0) return null;

  const onContext = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    pileMenu(ownerId, zone, e.nativeEvent.clientX, e.nativeEvent.clientY);
  };

  return (
    <group position={[pos.x, 0, pos.y]} rotation-y={-angle}>
      <mesh position-y={height / 2}>
        <boxGeometry args={[CARD_W * 0.98, height, CARD_H * 0.98]} />
        <meshStandardMaterial color="#1b1530" roughness={0.8} />
      </mesh>
      <mesh
        rotation-x={FLAT}
        position-y={height + 0.004}
        geometry={CARD_GEO}
        onContextMenu={onContext}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (zone === "library" && ownerId === me) act({ a: "draw", n: 1 });
          else if (zone !== "library" && (zone !== "sideboard" || ownerId === me)) useTableUi.getState().setViewer({ playerId: ownerId, zone });
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (zone === "graveyard" || zone === "exile" || (zone === "sideboard" && ownerId === me)) useTableUi.getState().setViewer({ playerId: ownerId, zone });
        }}
        onPointerOver={() => topData && setPreview({ cardId: topData.id })}
        onPointerOut={() => setPreview({})}
      >
        <meshStandardMaterial map={top ? tex : back} roughness={0.55} />
      </mesh>
      <group position={[0, height + 0.02, CARD_H / 2 + 0.5]} rotation-y={angle - viewerAngle}>
        <Label text={String(count)} position={[0, 0, 0]} height={0.6} />
      </group>
    </group>
  );
}

function OpponentHand({ count, seat, seatCount, viewerAngle }: { count: number; seat: number; seatCount: number; viewerAngle: number }) {
  const back = useMemo(() => backTexture(), []);
  const pos = localToTable({ x: 0, y: MAT_D / 2 + 2.4 }, seat, seatCount);
  const angle = seatAngle(seat, seatCount);
  const shown = Math.min(count, 10);
  return (
    <group position={[pos.x, 0.05, pos.y]} rotation-y={-angle}>
      {Array.from({ length: shown }, (_, i) => {
        const off = i - (shown - 1) / 2;
        return (
          <mesh key={i} geometry={CARD_GEO} rotation={[FLAT, 0, off * 0.08]} position={[off * 0.9, i * 0.01, Math.abs(off) * 0.08]} scale={0.7}>
            <meshStandardMaterial map={back} />
          </mesh>
        );
      })}
      <group position={[0, 0.2, 2]} rotation-y={angle - viewerAngle}>
        <Label text={`✋ ${count}`} position={[0, 0, 0]} height={0.7} />
      </group>
    </group>
  );
}

// --- battlefield cards ----------------------------------------------------------------------

function BattlefieldCard({ card, elevation, table, me }: { card: TableCard; elevation: number; table: TableState; me: string }) {
  const data = useStore((s) => (card.cardId ? s.cards[card.cardId] : undefined));
  const remote = useStore((s) => s.drags[card.id]);
  const drag = useTableUi((s) => (s.drag?.ids.includes(card.id) ? s.drag : null));
  const selected = useTableUi((s) => s.selected.includes(card.id));
  const hovered = useTableUi((s) => s.hovered === card.id);
  const setPreview = useStore((s) => s.setPreview);
  const showBack = card.hidden || card.faceDown;
  const tex = useCardTexture(showBack ? undefined : data, card.face, showBack ? undefined : card.token);
  const group = useRef<THREE.Group>(null);
  const controllerSeat = table.players[card.controller]?.seat ?? 0;
  const baseAngle = -seatAngle(controllerSeat, table.seats.length);

  // Target transform; the frame loop eases toward it (smooth taps, moves and remote drags).
  const target = useRef({ x: card.x, y: elevation, z: card.y, rot: baseAngle });
  let tx = card.x;
  let tz = card.y;
  let ty = elevation;
  if (drag) {
    const o = drag.offsets[card.id] ?? { dx: 0, dy: 0 };
    tx = drag.x + o.dx;
    tz = drag.y + o.dy;
    ty = 1.6;
  } else if (remote && performance.now() - remote.at < 600) {
    tx = remote.x;
    tz = remote.y;
    ty = 1.0;
  }
  target.current = { x: tx, y: ty, z: tz, rot: baseAngle - (card.tapped ? Math.PI / 2 : 0) };

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const a = 1 - Math.exp(-dt * (drag ? 30 : 12));
    g.position.x += (target.current.x - g.position.x) * a;
    g.position.y += (target.current.y - g.position.y) * a;
    g.position.z += (target.current.z - g.position.z) * a;
    g.rotation.y += (target.current.rot - g.rotation.y) * a;
  });

  const counters = Object.entries(card.counters);
  const peekable = card.faceDown && !card.hidden && (card.owner === me || card.controller === me);

  return (
    <group ref={group} position={[card.x, elevation, card.y]} rotation-y={baseAngle}>
      <mesh rotation-x={FLAT} position-y={-0.01 - (drag ? 1.2 : 0)} geometry={SHADOW_GEO}>
        <meshBasicMaterial color="#000" transparent opacity={drag ? 0.25 : 0.35} depthWrite={false} />
      </mesh>
      {(selected || hovered) && (
        <mesh rotation-x={FLAT} position-y={-0.004} geometry={OUTLINE_GEO}>
          <meshBasicMaterial color={selected ? "#45e0ff" : "#f4c55b"} transparent opacity={selected ? 0.95 : 0.7} />
        </mesh>
      )}
      <mesh
        rotation-x={FLAT}
        geometry={CARD_GEO}
        onPointerOver={(e) => {
          e.stopPropagation();
          useTableUi.getState().setHovered(card.id);
          if (!card.hidden && (data || card.token)) setPreview(data ? { cardId: data.id, face: card.face, foil: card.foil } : {});
        }}
        onPointerOut={() => {
          if (useTableUi.getState().hovered === card.id) useTableUi.getState().setHovered(null);
          setPreview({});
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const ui = useTableUi.getState();
          const ids = ui.selected.includes(card.id) ? ui.selected : [card.id];
          const shift = e.shiftKey;
          beginDrag(e.nativeEvent, "battlefield", ids, () => {
            const cur = useTableUi.getState().selected;
            if (shift) ui.setSelected(cur.includes(card.id) ? cur.filter((x) => x !== card.id) : [...cur, card.id]);
            else ui.setSelected([card.id]);
          });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          toggleTap([card.id]);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          battlefieldMenu(card, e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
      >
        <meshStandardMaterial map={tex} roughness={card.foil ? 0.25 : 0.5} metalness={card.foil ? 0.35 : 0} />
      </mesh>
      {[
        ...(peekable ? [{ text: "face down", variant: "muted" as const }] : []),
        ...(card.token && !showBack ? [{ text: "token", variant: "token" as const }] : []),
        ...counters.map(([k, v]) => ({ text: `${k} ×${v}`, variant: "counter" as const })),
      ].map((b, i) => (
        <Label key={b.text} text={b.text} variant={b.variant} position={[0, 0.02, CARD_H / 2 - 0.35 - i * 0.55]} height={0.48} />
      ))}
    </group>
  );
}

/** Flat text pill lying on the table (canvas texture; avoids DOM overlays in the 3D scene). */
function Label({ text, variant = "count", position, height }: { text: string; variant?: LabelVariant; position: [number, number, number]; height: number }) {
  const { texture, aspect } = labelTexture(text, variant);
  return (
    <mesh rotation-x={FLAT} position={position} renderOrder={5}>
      <planeGeometry args={[height * aspect, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}
