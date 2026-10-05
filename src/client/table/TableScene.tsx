// The 3D tabletop: felt table, one mat per seat, piles, battlefield cards and other players' hands,
// plus drag feedback (shadows, drop targets) and pings.

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";
import { handDragId } from "../../shared/table";
import type { PublicLook, TableCard, TableState } from "../../shared/types";
import { CARD_H, CARD_W, MAT_D, MAT_W, PILE_LOCAL, localToTable, pileAt, pilePosition, seatAngle, tableRadius, type PileZone } from "../../shared/tableLayout";
import { backTexture, feltTexture, glowTexture, labelTexture, lookTagTexture, matTexture, pingTagTexture, roundedRectGeometry, hueTexture, shadowTexture, SHADOW_PAD, spriteTexture, useCardTexture, useImage, type LabelVariant } from "./textures";
import { battlefieldMenu, pileMenu, pingAt, toggleTap, useTableUi, act, PING_MS, type Ping } from "./tableUi";
import { beginDrag, tableApi } from "./drag";
import { DRAG_LIFT, livePoses, motionScale, reducedMotion, useMotion } from "./motion";
import { easeInOutCubic, Flights } from "./Flights";
import type { IconName } from "../icons";
import { shortcutsBlocked } from "../shortcuts";
import { accentOf, avatarFace, companionArt, companionDef, variantHue } from "../roster";

const CARD_GEO = roundedRectGeometry(CARD_W, CARD_H, 0.14);
const OUTLINE_GEO = roundedRectGeometry(CARD_W + 0.22, CARD_H + 0.22, 0.24);
const SHADOW_GEO = roundedRectGeometry(CARD_W + 0.3, CARD_H + 0.3, 0.3);
const SOFT_SHADOW_GEO = new THREE.PlaneGeometry(CARD_W + SHADOW_PAD, CARD_H + SHADOW_PAD);
const PILE_TARGET_GEO = roundedRectGeometry(CARD_W + 0.7, CARD_H + 0.7, 0.3);
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
  // The camera can sit behind anyone's seat; labels turn to face it.
  const pov = useTableUi((s) => s.pov);
  const povSeat = pov && table.seats.includes(pov) ? table.seats.indexOf(pov) : mySeat;

  const battlefield = useMemo(() => {
    const list = Object.values(table.cards).filter((c) => c.zone === "battlefield");
    list.sort((a, b) => a.z - b.z);
    return list;
  }, [table.cards]);
  // Drag shadows lie just above the highest resting card, so stacks never hide the landing spot.
  const shadowY = 0.03 + battlefield.length * 0.004 + 0.012;
  const keys = useMotion((s) => s.keys);

  return (
    <>
      <color attach="background" args={["#07060c"]} />
      <fog attach="fog" args={["#07060c", 70, 190]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[12, 40, 18]} intensity={1.4} />
      <hemisphereLight args={["#b9a6ff", "#1a1020", 0.5]} />
      <ScreenApi />
      <CameraRig seat={povSeat} seatCount={n} />
      <TableSurface seatCount={n} />
      {table.seats.map((pid, seat) => (
        <SeatArea key={pid} table={table} playerId={pid} seat={seat} seatCount={n} isMe={pid === me} viewerAngle={seatAngle(povSeat, n)} />
      ))}
      {battlefield.map((card, i) => (
        <BattlefieldCard key={keys[card.id] ?? card.id} card={card} elevation={0.03 + i * 0.004} shadowY={shadowY} table={table} me={me} />
      ))}
      <DropTarget mySeat={mySeat} seatCount={n} shadowY={shadowY} />
      <RemoteHandDrags table={table} shadowY={shadowY} />
      <Pings table={table} />
      <Flights />
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
      if (typing(e) || shortcutsBlocked()) return;
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
          if (!e.shiftKey) useTableUi.getState().set({ selected: [], handSelected: null });
          panApi.start(e.nativeEvent);
        }}
        onContextMenu={(e) => {
          e.nativeEvent.preventDefault();
          const { x, z } = e.point;
          useStore.getState().openMenu({
            x: e.nativeEvent.clientX,
            y: e.nativeEvent.clientY,
            title: "Table",
            items: [{ label: "Ping here", icon: "pin", hint: "Tab", onSelect: () => pingAt(x, z) }],
          });
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
  const offline = useStore((s) => s.view?.players.find((p) => p.id === playerId)?.connected === false);
  const look = useStore((s) => s.view?.players.find((p) => p.id === playerId));
  const face = useImage(look ? avatarFace(look.avatar) : null);
  const accent = look ? accentOf(look) : undefined;
  const tex = useMemo(() => matTexture(name, seatHue(seat), isMe, face, accent), [name, seat, isMe, face, accent]);
  const center = localToTable({ x: 0, y: 0 }, seat, seatCount);
  // In the empty strip left of the battlefield, below the sideboard, so it never covers their cards.
  const offlineAt = localToTable({ x: PILE_LOCAL.sideboard.x, y: -1.5 }, seat, seatCount);
  const angle = seatAngle(seat, seatCount);
  const player = table.players[playerId];
  const arriving = useMotion((s) => s.arriving);
  const handCount = player?.zones.hand.filter((id) => !arriving[id]).length ?? 0;
  // Someone who dropped out isn't looking at anything (their look waits for them to come back).
  const peek = offline ? undefined : table.looks?.[playerId];

  return (
    <group>
      <mesh rotation={[FLAT, 0, -angle]} position={[center.x, 0, center.y]} renderOrder={1}>
        <planeGeometry args={[MAT_W, MAT_D]} />
        {/* A player who dropped out: their mat dims and says so, until they're back. */}
        <meshStandardMaterial map={tex} transparent roughness={0.9} depthWrite={false} color={offline ? "#6b6b78" : "#ffffff"} />
      </mesh>
      {offline && (
        <group position={[offlineAt.x, 0.05, offlineAt.y]} rotation-y={-viewerAngle}>
          <Label text="Offline" icon="offline" variant="muted" position={[0, 0, 0]} height={0.9} />
        </group>
      )}
      {(["library", "graveyard", "exile", "sideboard"] as PileZone[]).map((zone) => (
        <Pile key={zone} table={table} ownerId={playerId} zone={zone} seat={seat} seatCount={seatCount} viewerAngle={viewerAngle} />
      ))}
      {peek && <LibraryLook look={peek} libraryCount={player?.zones.library.length ?? 0} seat={seat} seatCount={seatCount} />}
      {!isMe && handCount > 0 && <OpponentHand count={handCount} seat={seat} seatCount={seatCount} viewerAngle={viewerAngle} />}
      {look?.companion && <CompanionFigure companion={look.companion} variant={look.companionVariant ?? 0} seat={seat} seatCount={seatCount} active={table.turn.playerId === playerId} offline={offline} />}
    </group>
  );
}

const PET_SIZE = 2.8;
/** How long a companion hops after its player's turn starts: full height, then easing off to rest. */
const HOP_SECONDS = 5;
const HOP_EASE_SECONDS = 1.5;

/** The player's companion standing by the back-left corner of their mat: a picture for now, until it becomes a 3D model. It hops when its player's turn starts, then settles. */
function CompanionFigure({ companion, variant, seat, seatCount, active, offline }: { companion: string; variant: number; seat: number; seatCount: number; active: boolean; offline: boolean }) {
  const def = companionDef(companion);
  const url = companionArt(companion);
  const img = useImage(variant > 0 ? url : null);
  const hue = variantHue(variant);
  const tex = useMemo(() => (img && hue ? hueTexture(img, hue) : spriteTexture(url)), [url, img, hue]);
  const at = localToTable({ x: -MAT_W / 2 - 1.3, y: -MAT_D / 2 + 2.4 }, seat, seatCount);
  const body = useRef<THREE.Group>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  // When this player's turn started (or the table opened on it), so the hopping can wind down.
  const turnStart = useRef<number | null>(null);
  useEffect(() => {
    turnStart.current = active ? performance.now() : null;
  }, [active]);
  useFrame(({ clock }) => {
    const g = body.current;
    if (!g) return;
    const t = clock.elapsedTime + phase;
    if (reducedMotion() || offline) {
      g.position.y = 0;
      g.scale.set(1, 1, 1);
      return;
    }
    // Idle: a slow breath. Just after their turn starts: hops that ease off to rest.
    const sinceTurn = turnStart.current === null ? Infinity : (performance.now() - turnStart.current) / 1000;
    const fade = Math.min(1, Math.max(0, (HOP_SECONDS - sinceTurn) / HOP_EASE_SECONDS));
    const hop = Math.abs(Math.sin(t * 3.2)) * 0.4 * fade;
    const breath = 1 + Math.sin(t * 1.6) * 0.018;
    g.position.y = hop;
    g.scale.set(1 / breath, breath, 1);
  });
  if (!def) return null;
  return (
    <group position={[at.x, 0.04, at.y]}>
      <mesh rotation-x={FLAT} position-y={0.02} renderOrder={2} raycast={() => null}>
        <planeGeometry args={[PET_SIZE * 0.78, PET_SIZE * 0.34]} />
        <meshBasicMaterial map={glowTexture()} color="#000000" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <group ref={body}>
        <sprite scale={[PET_SIZE, PET_SIZE, 1]} center={[0.5, 0.06]} renderOrder={6} raycast={() => null}>
          <spriteMaterial map={tex} transparent toneMapped={false} depthWrite={false} color={offline ? "#7a7a88" : "#ffffff"} />
        </sprite>
      </group>
    </group>
  );
}

function Pile({ table, ownerId, zone, seat, seatCount, viewerAngle }: { table: TableState; ownerId: string; zone: PileZone; seat: number; seatCount: number; viewerAngle: number }) {
  // Cards still flying in don't count yet (and don't spoil the top of the graveyard early).
  const arriving = useMotion((s) => s.arriving);
  const all = table.players[ownerId]?.zones[zone] ?? [];
  const ids = all.filter((id) => !arriving[id]);
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
        <Label text={String(count)} icon="hand" position={[0, 0, 0]} height={0.7} />
      </group>
    </group>
  );
}

// --- library looks --------------------------------------------------------------------------

/** How long the glow takes to breathe in and out, and a search takes to thumb through a few cards. */
const LOOK_PULSE_S = 1.6;
const SEARCH_THUMB_S = 1.2;
/** Cards held up over the library during "look at top X" (more than this just makes a taller fan). */
const LOOK_MAX_SHOWN = 7;

/**
 * Someone looking through their library (a search, or "look at top X"): the pile glows in their
 * colour with a tag over it, the way everyone at a real table sees a player pick up their library.
 * "Look at top X" holds up the cards still being looked at; a search keeps thumbing through the pile.
 */
function LibraryLook({ look, libraryCount, seat, seatCount }: { look: PublicLook; libraryCount: number; seat: number; seatCount: number }) {
  const hue = seatHue(seat);
  const color = useMemo(() => new THREE.Color().setHSL(hue / 360, 0.85, 0.62), [hue]);
  const glow = useMemo(() => glowTexture(), []);
  const back = useMemo(() => backTexture(), []);
  const text = look.kind === "search" ? "Searching library" : look.left < look.n ? `Top ${look.n}: ${look.left} left` : `Looking at top ${look.n}`;
  const tag = lookTagTexture(text, hue, look.kind === "search" ? "search" : "eye");
  const pos = pilePosition("library", seat, seatCount);
  const angle = seatAngle(seat, seatCount);
  const pileTop = Math.min(libraryCount, 60) * 0.018;
  // Nothing to thumb through once a search has emptied the library.
  const shown = look.kind === "top" ? Math.min(look.left, LOOK_MAX_SHOWN) : libraryCount > 0 ? 3 : 0;
  const since = useRef(performance.now());
  const root = useRef<THREE.Group>(null);
  const spot = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const held = useRef<THREE.Group>(null);
  const label = useRef<THREE.Sprite>(null);
  const thumbs = useRef<(THREE.Group | null)[]>([]);

  useFrame(() => {
    const still = reducedMotion();
    const t = still ? 0 : (performance.now() - since.current) / 1000;
    const inT = still ? 1 : Math.min(1, t / 0.35);
    const breath = (Math.sin((t / LOOK_PULSE_S) * Math.PI * 2) + 1) / 2;
    if (root.current) root.current.scale.setScalar(Math.max(0.001, easeOutBack(inT)));
    if (spot.current) spot.current.opacity = 0.55 + breath * 0.35;
    if (ring.current) {
      ring.current.visible = !still;
      const q = (t / LOOK_PULSE_S) % 1;
      ring.current.scale.setScalar(2.4 + q * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - q) ** 1.5 * 0.7;
    }
    const bob = Math.sin(t * 2.2) * 0.12;
    if (held.current) held.current.position.y = pileTop + 1.1 + bob;
    if (label.current) label.current.position.y = pileTop + 3.9 + bob;
    // A search lifts the cards one after another from the owner's side, like thumbing through.
    thumbs.current.forEach((g, k) => {
      if (!g) return;
      const p = (t / SEARCH_THUMB_S + k / shown) % 1;
      const lift = still ? (k === 0 ? 0.5 : 0) : Math.max(0, Math.sin(p * Math.PI * 2)) ** 2;
      g.rotation.x = -lift * 1.2;
    });
  });

  const overlay = { transparent: true, depthWrite: false } as const;
  return (
    <group position={[pos.x, 0, pos.y]} rotation-y={-angle}>
      <group ref={root}>
        <mesh rotation-x={FLAT} position-y={0.02}>
          <planeGeometry args={[CARD_W * 2.6, CARD_H * 2.2]} />
          <meshBasicMaterial ref={spot} map={glow} color={color} {...overlay} opacity={0} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh ref={ring} rotation-x={FLAT} position-y={0.03} geometry={RING_GEO} visible={false}>
          <meshBasicMaterial color={color} {...overlay} opacity={0} />
        </mesh>
        {look.kind === "top" ? (
          // Held up over the pile, tilted towards their owner, backs to the table.
          <group ref={held} position-y={pileTop + 1.1} rotation-x={FLAT + 0.35}>
            {Array.from({ length: shown }, (_, i) => {
              const off = i - (shown - 1) / 2;
              return (
                <mesh key={i} geometry={CARD_GEO} position={[off * 0.55, -Math.abs(off) * 0.08, i * 0.012]} rotation-z={-off * 0.09} scale={0.8} raycast={NO_RAYCAST}>
                  <meshStandardMaterial map={back} roughness={0.55} emissive={color} emissiveIntensity={0.12} />
                </mesh>
              );
            })}
          </group>
        ) : (
          Array.from({ length: shown }, (_, k) => (
            // Hinged at the edge facing the middle of the table, so the owner's side lifts.
            <group key={k} ref={(g) => void (thumbs.current[k] = g)} position={[0, pileTop + 0.01 + k * 0.012, -CARD_H / 2]}>
              <mesh geometry={CARD_GEO} rotation-x={FLAT} position-z={CARD_H / 2} raycast={NO_RAYCAST}>
                <meshStandardMaterial map={back} roughness={0.55} emissive={color} emissiveIntensity={0.12} side={THREE.DoubleSide} />
              </mesh>
            </group>
          ))
        )}
      </group>
      <sprite ref={label} position-y={pileTop + 3.9} scale={[1.05 * tag.aspect, 1.05, 1]} renderOrder={23}>
        <spriteMaterial map={tag.texture} transparent depthTest={false} depthWrite={false} />
      </sprite>
    </group>
  );
}

// --- battlefield cards ----------------------------------------------------------------------

/** Tapping: a little hop while the card turns. */
const TAP_HOP_MS = 300;
/** Turning face down / face up or transforming: a flip over the long edge. */
const FLIP_MS = 420;
/** A new token popping onto the table. */
const SPAWN_MS = 480;
const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
const NO_RAYCAST = () => {};

function BattlefieldCard({ card, elevation, shadowY, table, me }: { card: TableCard; elevation: number; shadowY: number; table: TableState; me: string }) {
  const data = useStore((s) => (card.cardId ? s.cards[card.cardId] : undefined));
  const drag = useTableUi((s) => (s.drag?.ids.includes(card.id) ? s.drag : null));
  const settling = useTableUi((s) => s.settling[card.id]);
  const selected = useTableUi((s) => s.selected.includes(card.id));
  const hovered = useTableUi((s) => s.hovered === card.id);
  // Still flying in from its previous zone (Flights draws it until it lands).
  const arriving = useMotion((s) => !!s.arriving[card.id]);
  const setPreview = useStore((s) => s.setPreview);
  const showBack = card.hidden || card.faceDown;
  const tex = useCardTexture(showBack ? undefined : data, card.face, showBack ? undefined : card.token);
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const flipper = useRef<THREE.Group>(null);
  const cardMat = useRef<THREE.MeshStandardMaterial>(null);
  const restShadow = useRef<THREE.MeshBasicMaterial>(null);
  const liftShadow = useRef<THREE.Group>(null);
  const liftShadowMat = useRef<THREE.MeshBasicMaterial>(null);
  const shadows = useMemo(() => ({ soft: shadowTexture("soft"), landing: shadowTexture("landing") }), []);
  const controllerSeat = table.players[card.controller]?.seat ?? 0;
  const baseAngle = -seatAngle(controllerSeat, table.seats.length);

  // Target transform; the frame loop eases toward it (smooth taps, moves and remote drags).
  const target = useRef({ x: card.x, y: elevation, z: card.y, rot: baseAngle });
  // Someone else's drag overrides the target in the frame loop, which also notices when it goes
  // stale: a drag they backed out of ends without any state change to re-render this card.
  const remoteCanMove = useRef(true);
  remoteCanMove.current = !drag;
  let tx = card.x;
  let tz = card.y;
  let ty = elevation;
  if (drag) {
    const o = drag.offsets[card.id] ?? { dx: 0, dy: 0 };
    tx = drag.x + o.dx;
    tz = drag.y + o.dy;
    ty = DRAG_LIFT;
  } else if (settling) {
    // Just dropped: head for the drop spot while the server confirms, instead of snapping back.
    tx = settling.x;
    tz = settling.y;
  }
  target.current = { x: tx, y: ty, z: tz, rot: baseAngle - (card.tapped ? Math.PI / 2 : 0) };

  // The server's position arrived (or someone else moved it): stop overriding it.
  useEffect(() => {
    const ui = useTableUi.getState();
    if (!ui.settling[card.id]) return;
    const { [card.id]: _, ...rest } = ui.settling;
    ui.set({ settling: rest });
  }, [card.id, card.x, card.y]);

  // Cards leaving the battlefield start their flight from exactly where this one is drawn.
  useEffect(() => {
    const pose = () => {
      const g = group.current!;
      return { x: g.position.x, y: g.position.z, h: g.position.y + (body.current?.position.y ?? 0), yaw: g.rotation.y };
    };
    livePoses.set(card.id, pose);
    return () => {
      if (livePoses.get(card.id) === pose) livePoses.delete(card.id);
      // Leaving the table from under the pointer never fires pointer-out: drop its hover preview.
      if (useTableUi.getState().hovered === card.id) {
        useTableUi.getState().setHovered(null);
        useStore.getState().setPreview({});
      }
    };
  }, [card.id]);

  // Tapped / untapped: turn (after its turn in an "untap all" ripple) with a little hop.
  const tapAnim = useRef<{ start: number; fromRot: number } | null>(null);
  const firstTap = useRef(true);
  useLayoutEffect(() => {
    if (firstTap.current) {
      firstTap.current = false;
      return;
    }
    if (!group.current || reducedMotion()) return;
    tapAnim.current = { start: performance.now() + (useMotion.getState().tapDelay[card.id] ?? 0), fromRot: group.current.rotation.y };
    // Not on an id change (a face-down card turned face up keeps its scene object: see useMotion's keys).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.tapped]);

  // Turned face down / up or transformed: flip over, showing the old face until it's edge-on.
  const faceKey = showBack ? "back" : `face${card.face}`;
  const shownTex = useRef(tex);
  const flipAnim = useRef<{ start: number; from: THREE.Texture } | null>(null);
  const lastFaceKey = useRef(faceKey);
  useLayoutEffect(() => {
    if (lastFaceKey.current === faceKey) return;
    lastFaceKey.current = faceKey;
    if (!reducedMotion()) flipAnim.current = { start: performance.now(), from: shownTex.current };
  }, [faceKey]);
  useLayoutEffect(() => {
    shownTex.current = tex;
  }, [tex]);

  // A brand-new token pops in.
  const spawnAt = useRef<number | undefined>(useMotion.getState().spawns[card.id]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const now = performance.now();
    const a = 1 - Math.exp(-dt * (drag ? 30 : 12));
    const remote = useStore.getState().drags[card.id];
    const t = remoteCanMove.current && remote && now - remote.at < REMOTE_DRAG_MS ? { ...target.current, x: remote.x, y: 1.0, z: remote.y } : target.current;
    g.position.x += (t.x - g.position.x) * a;
    g.position.y += (t.y - g.position.y) * a;
    g.position.z += (t.z - g.position.z) * a;

    let hop = 0;
    let scale = 1;
    const tap = tapAnim.current;
    let rot = t.rot;
    if (tap) {
      const u = (now - tap.start) / (TAP_HOP_MS * motionScale());
      if (u < 0) rot = tap.fromRot;
      else if (u < 1) hop += Math.sin(Math.PI * u) * 0.35;
      else tapAnim.current = null;
    }
    g.rotation.y += (rot - g.rotation.y) * (tap && now >= tap.start ? 1 - Math.exp(-dt * 16) : a);

    const flip = flipAnim.current;
    if (flipper.current && cardMat.current) {
      if (flip) {
        const u = Math.min(1, (now - flip.start) / (FLIP_MS * motionScale()));
        const angle = easeInOutCubic(u) * Math.PI;
        // First half: the old face tips up to edge-on; second half: the new face comes down.
        flipper.current.rotation.z = angle < Math.PI / 2 ? angle : angle - Math.PI;
        cardMat.current.map = angle < Math.PI / 2 ? flip.from : shownTex.current;
        hop += Math.sin(Math.PI * u) * 0.9;
        if (u >= 1) flipAnim.current = null;
      } else if (flipper.current.rotation.z !== 0) {
        flipper.current.rotation.z = 0;
        cardMat.current.map = shownTex.current;
      }
    }

    const spawn = spawnAt.current;
    if (spawn !== undefined) {
      const u = (now - spawn) / (SPAWN_MS * motionScale());
      if (u < 0) scale = 0.001;
      else if (u < 1) {
        scale = Math.max(0.001, easeOutBack(u));
        hop += (1 - u) ** 2 * 2.2;
      } else spawnAt.current = undefined;
    }
    if (body.current) {
      body.current.position.y = hop;
      body.current.scale.setScalar(scale);
    }

    // Lifted (dragged here or by someone else): the contact shadow gives way to a soft shadow on the
    // table that spreads and fades with height. For our own drag it sits exactly where the card
    // will land (under the pointer), with a faint outline.
    const lift = Math.max(0, g.position.y - elevation) + hop;
    const k = Math.min(1, lift / 0.4);
    if (restShadow.current) restShadow.current.opacity = 0.35 * (1 - k) * Math.min(1, scale);
    const ls = liftShadow.current;
    if (!ls || !liftShadowMat.current) return;
    ls.visible = k > 0.02 && !arriving;
    if (!ls.visible) return;
    const at = drag ? target.current : g.position;
    ls.position.set(at.x, shadowY, at.z);
    ls.rotation.y = drag ? target.current.rot : g.rotation.y;
    const spread = 1 + lift * 0.09;
    ls.scale.set(spread, 1, spread);
    liftShadowMat.current.opacity = k * Math.max(0.3, 0.82 - lift * 0.16) * Math.min(1, scale);
  });

  const counters = Object.entries(card.counters);
  const peekable = card.faceDown && !card.hidden && (card.owner === me || card.controller === me);

  return (
    <>
      <group ref={liftShadow} visible={false}>
        <mesh rotation-x={FLAT} geometry={SOFT_SHADOW_GEO} renderOrder={2}>
          <meshBasicMaterial ref={liftShadowMat} map={drag ? shadows.landing : shadows.soft} transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <group ref={group} position={[card.x, elevation, card.y]} rotation-y={baseAngle} visible={!arriving}>
        <mesh rotation-x={FLAT} position-y={-0.01} geometry={SHADOW_GEO}>
          <meshBasicMaterial ref={restShadow} color="#000" transparent opacity={0.35} depthWrite={false} />
        </mesh>
        <group ref={body}>
          {(selected || hovered) && (
            <mesh rotation-x={FLAT} position-y={-0.004} geometry={OUTLINE_GEO}>
              <meshBasicMaterial color={selected ? "#45e0ff" : "#f4c55b"} transparent opacity={selected ? 0.95 : 0.7} />
            </mesh>
          )}
          <group ref={flipper}>
            <mesh
              rotation-x={FLAT}
              geometry={CARD_GEO}
              // Hidden while it flies in: nothing to hover, drag or right-click yet.
              raycast={arriving ? NO_RAYCAST : THREE.Mesh.prototype.raycast}
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
                  else ui.set({ selected: [card.id], handSelected: null });
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
              <meshStandardMaterial ref={cardMat} map={tex} roughness={card.foil ? 0.25 : 0.5} metalness={card.foil ? 0.35 : 0} />
            </mesh>
          </group>
          {[
            ...(peekable ? [{ text: "face down", variant: "muted" as const }] : []),
            ...(card.token && !showBack ? [{ text: "token", variant: "token" as const }] : []),
            ...counters.map(([k, v]) => ({ text: `${k} ×${v}`, variant: "counter" as const })),
          ].map((b, i) => (
            <Label key={b.text} text={b.text} variant={b.variant} position={[0, 0.02, CARD_H / 2 - 0.35 - i * 0.55]} height={0.48} />
          ))}
        </group>
      </group>
    </>
  );
}

// --- drag feedback --------------------------------------------------------------------------

/** Drop feedback: a glowing slot when over a pile, and a 3D body for cards dragged out of the hand. */
function DropTarget({ mySeat, seatCount, shadowY }: { mySeat: number; seatCount: number; shadowY: number }) {
  const drag = useTableUi((s) => s.drag);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = 0.45 + Math.sin(clock.elapsedTime * 7) * 0.2;
  });
  if (!drag || drag.overHand) return null;
  const pile = pileAt({ x: drag.x, y: drag.y }, seatCount);
  const pos = pile ? pilePosition(pile.zone, pile.seat, seatCount) : null;
  return (
    <>
      {pile && pos && (
        <mesh position={[pos.x, 0.012, pos.y]} rotation={[FLAT, 0, -seatAngle(pile.seat, seatCount)]} geometry={PILE_TARGET_GEO} renderOrder={2}>
          <meshBasicMaterial ref={glow} color="#f4c55b" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}
      {drag.source === "hand" && <HandDragCard id={drag.ids[0]} x={drag.x} y={drag.y} angle={-seatAngle(mySeat, seatCount)} shadowY={shadowY} onPile={!!pile} />}
    </>
  );
}

/**
 * A card pulled out of the hand, floating over the table where it will land (it replaces the flat
 * DOM ghost once the pointer leaves the hand), with its landing shadow underneath.
 */
function HandDragCard({ id, x, y, angle, shadowY, onPile }: { id: string; x: number; y: number; angle: number; shadowY: number; onPile: boolean }) {
  const card = useStore((s) => s.view?.table?.cards[id]);
  const data = useStore((s) => (card?.cardId ? s.cards[card.cardId] : undefined));
  const face = useTableUi((s) => s.handFaces[id] ?? 0);
  const tex = useCardTexture(data, face);
  const landing = useMemo(() => shadowTexture("landing"), []);
  const body = useRef<THREE.Group>(null);
  const target = useRef({ x, y });
  target.current = { x, y };
  useFrame((_, dt) => {
    const g = body.current;
    if (!g) return;
    const a = 1 - Math.exp(-dt * 30);
    g.position.x += (target.current.x - g.position.x) * a;
    g.position.z += (target.current.y - g.position.z) * a;
  });
  return (
    <>
      {!onPile && (
        <mesh position={[x, shadowY, y]} rotation={[FLAT, 0, angle]} geometry={SOFT_SHADOW_GEO} renderOrder={2}>
          <meshBasicMaterial map={landing} transparent opacity={0.56} depthWrite={false} />
        </mesh>
      )}
      <group ref={body} position={[x, DRAG_LIFT, y]} rotation-y={angle}>
        <mesh rotation-x={FLAT} geometry={CARD_GEO}>
          <meshStandardMaterial map={tex} roughness={card?.foil ? 0.25 : 0.5} metalness={card?.foil ? 0.35 : 0} />
        </mesh>
      </group>
    </>
  );
}

/** How long a remote drag position stays live without a fresh update (drags stream every ~50 ms). */
const REMOTE_DRAG_MS = 600;

/**
 * Cards other players are pulling out of their hands, shown face down under their pointer until
 * they're played (then the battlefield card takes over) or put back. These drags come under
 * handDragId, not a card id: which card of the hand it is isn't anyone else's business.
 */
function RemoteHandDrags({ table, shadowY }: { table: TableState; shadowY: number }) {
  const drags = useStore((s) => s.drags);
  const ids = Object.keys(drags).filter((id) => id === handDragId(drags[id].by));
  return (
    <>
      {ids.map((id) => (
        <RemoteHandCard key={id} id={id} angle={-seatAngle(table.players[drags[id].by]?.seat ?? 0, table.seats.length)} shadowY={shadowY} />
      ))}
    </>
  );
}

function RemoteHandCard({ id, angle, shadowY }: { id: string; angle: number; shadowY: number }) {
  const back = useMemo(() => backTexture(), []);
  const soft = useMemo(() => shadowTexture("soft"), []);
  const group = useRef<THREE.Group>(null);
  const start = useStore.getState().drags[id];
  useFrame((_, dt) => {
    const g = group.current;
    const d = useStore.getState().drags[id];
    if (!g || !d) return;
    // Stale (dropped back into the hand, or the player went quiet): hide until the next update.
    g.visible = performance.now() - d.at < REMOTE_DRAG_MS;
    const a = 1 - Math.exp(-dt * 20);
    g.position.x += (d.x - g.position.x) * a;
    g.position.z += (d.y - g.position.z) * a;
  });
  return (
    <group ref={group} position={[start?.x ?? 0, DRAG_LIFT, start?.y ?? 0]} rotation-y={angle}>
      <mesh rotation-x={FLAT} position-y={shadowY - DRAG_LIFT} geometry={SOFT_SHADOW_GEO} renderOrder={2}>
        <meshBasicMaterial map={soft} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <mesh rotation-x={FLAT} geometry={CARD_GEO}>
        <meshStandardMaterial map={back} roughness={0.55} />
      </mesh>
    </group>
  );
}

// --- pings ----------------------------------------------------------------------------------

function Pings({ table }: { table: TableState }) {
  const pings = useTableUi((s) => s.pings);
  const players = useStore((s) => s.view?.players);
  return (
    <>
      {pings.map((p) => (
        <PingMarker key={p.id} ping={p} hue={seatHue(Math.max(0, table.seats.indexOf(p.by)))} name={players?.find((x) => x.id === p.by)?.name ?? "Someone"} />
      ))}
    </>
  );
}

const RING_GEO = new THREE.RingGeometry(0.82, 1, 64);
const PING_ARROW_SCALE = 1.35;

/**
 * A spinning, bobbing arrow in the player's colour with ripples spreading over the table and a
 * name tag, like Tabletop Simulator's pointer. Drawn over everything so cards never hide it.
 */
function PingMarker({ ping, hue, name }: { ping: Ping; hue: number; name: string }) {
  const color = useMemo(() => new THREE.Color().setHSL(hue / 360, 0.85, 0.62), [hue]);
  const tag = pingTagTexture(name, hue);
  const glow = useMemo(() => glowTexture(), []);
  const arrow = useRef<THREE.Group>(null);
  const label = useRef<THREE.Sprite>(null);
  const spot = useRef<THREE.MeshBasicMaterial>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const fading = useRef<(THREE.Material | null)[]>([]);

  useFrame(() => {
    const t = (performance.now() - ping.at) / 1000;
    const inT = Math.min(1, t / 0.35);
    const fade = THREE.MathUtils.clamp((PING_MS / 1000 - t) / 0.7, 0, 1);
    const a = arrow.current;
    if (a) {
      // Drops in from above, then spins and bobs with its tip just over the table.
      a.position.y = 0.45 + (Math.sin(t * 4.2) + 1) * 0.22 + (1 - inT) ** 2 * 4;
      a.rotation.y = t * 2.8;
      a.scale.setScalar(Math.max(0.001, easeOutBack(inT) * PING_ARROW_SCALE));
    }
    if (label.current) label.current.position.y = (a?.position.y ?? 0) + 2.3 * PING_ARROW_SCALE + 0.9;
    for (const m of fading.current) if (m) m.opacity = fade;
    if (spot.current) spot.current.opacity = (0.5 + Math.sin(t * 6) * 0.12) * fade * inT;
    rings.current.forEach((ring, k) => {
      if (!ring) return;
      const p = t * 0.85 - k / 3;
      ring.visible = p >= 0;
      const q = p - Math.floor(p);
      ring.scale.setScalar(0.35 + q * 2.8);
      (ring.material as THREE.MeshBasicMaterial).opacity = (1 - q) ** 1.5 * 0.9 * fade;
    });
  });

  const overlay = { transparent: true, depthTest: false, depthWrite: false } as const;
  return (
    <group position={[ping.x, 0, ping.y]}>
      <mesh rotation-x={FLAT} position-y={0.05} renderOrder={20}>
        <planeGeometry args={[3.2, 3.2]} />
        <meshBasicMaterial ref={spot} map={glow} color={color} {...overlay} opacity={0} blending={THREE.AdditiveBlending} />
      </mesh>
      {[0, 1, 2].map((k) => (
        <mesh key={k} ref={(m) => void (rings.current[k] = m)} rotation-x={FLAT} position-y={0.06} geometry={RING_GEO} renderOrder={21} visible={false}>
          <meshBasicMaterial color={color} {...overlay} opacity={0} />
        </mesh>
      ))}
      <group ref={arrow}>
        {/* Four-sided head pointing down (tip at the group origin) and a square shaft above it. */}
        <mesh position-y={0.6} rotation-x={Math.PI} renderOrder={22}>
          <coneGeometry args={[0.62, 1.2, 4]} />
          <meshStandardMaterial ref={(m) => void (fading.current[0] = m)} color={color} emissive={color} emissiveIntensity={0.45} roughness={0.35} {...overlay} />
        </mesh>
        <mesh position-y={1.75} renderOrder={22}>
          <boxGeometry args={[0.34, 1.1, 0.34]} />
          <meshStandardMaterial ref={(m) => void (fading.current[1] = m)} color={color} emissive={color} emissiveIntensity={0.45} roughness={0.35} {...overlay} />
        </mesh>
      </group>
      <sprite ref={label} scale={[0.95 * tag.aspect, 0.95, 1]} renderOrder={23}>
        <spriteMaterial ref={(m) => void (fading.current[2] = m)} map={tag.texture} {...overlay} />
      </sprite>
    </group>
  );
}

/** Flat text pill lying on the table (canvas texture; avoids DOM overlays in the 3D scene). */
function Label({ text, icon, variant = "count", position, height }: { text: string; icon?: IconName; variant?: LabelVariant; position: [number, number, number]; height: number }) {
  const { texture, aspect } = labelTexture(text, variant, icon);
  return (
    <mesh rotation-x={FLAT} position={position} renderOrder={5}>
      <planeGeometry args={[height * aspect, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}
