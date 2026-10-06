// The Treatomancer: a wizard's gumball machine on the table. A glass globe of capsules on a violet cabinet with
// goggly eyes, a marquee, a crank and a chute, under a floppy star-spangled hat. Click it for its menu
// (TreatMenu.tsx); while a show plays (treatShow.ts) it rattles, winds up and fires the capsule out of its top,
// hat and all.
//
// It stands out by the rim left of the viewer's own mat (machineSpot in shared/treats.ts), where their camera has it
// in view, so every player has their own copy: only where a treat flies *from* differs between screens, never where
// it lands or what happens after. Players can pick theirs up and move it (machineCarry.ts): held by its hat, it
// dangles and swings as it's carried, reddens over a mat, and lands with a bump (or goes back with a shake).
// Procedural geometry only, no model files.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { localToTable, type Vec2 } from "../../shared/tableLayout";
import { glowTexture } from "./textures";
import { reducedMotion } from "./motion";
import { BEATS, machineSpot } from "../../shared/treats";
import { machineAnchor, machineMouth, showBusy, showTime, useTreats } from "./treatState";
import { openVend } from "./treatShow";
import { machineBeat, machinePos, machineTarget, pressMachine } from "./machineCarry";
import { loadTreatSounds } from "../treatSounds";

/** Heights in model units (the whole thing is drawn at SCALE): cabinet, globe, hat. */
const POST_TOP = 0;
const CAB_H = 11;
const CAB_W = 15;
const CAB_D = 11;
const GLOBE_R = 7.2;
const GLOBE_Y = POST_TOP + CAB_H + 1.4 + GLOBE_R - 0.8;
const CAP_Y = GLOBE_Y + GLOBE_R - 0.6;
/** How big the whole thing is drawn: about four companions tall. */
const SCALE = 0.18;
/** Carried: how high it's held (model units, ~1.8 table units), where it hangs from (the crown of its hat), how much
 * bigger it looks up there, and how far it swings (rad) from being moved across the screen (per unit/s). */
const LIFT_H = 10;
const PIVOT_Y = 32;
const LIFT_GROW = 0.06;
const DANGLE_MAX = 0.32;
const DANGLE_PER_SPEED = 0.02;

const FLAT = -Math.PI / 2;
const BRASS = { color: "#e8b65a", metalness: 0.35, roughness: 0.32, emissive: "#3a2400", emissiveIntensity: 0.4 } as const;
const VIOLET = { color: "#7438ad", roughness: 0.42, metalness: 0.05, emissive: "#24083f", emissiveIntensity: 0.5 } as const;
const CAPSULE_COLORS = ["#ff5d8f", "#ffd84a", "#5fb8ff", "#7bd957", "#b59cff", "#ff8a2b", "#45e0ff", "#ff7ab6"];
const HALO = new THREE.Color("#c9a0ff");
const NOPE = new THREE.Color("#ff3030");
const BLACK = new THREE.Color("#000000");
const GLOBE_GLOW = new THREE.Color("#b59cff");

/**
 * The machine of the player at `povSeat` (the seat the camera is behind): where they put it (`stored`), or else its
 * default spot. `canMove`: it's the viewer's own (they're seated, looking from their seat), so they can pick it up.
 */
export function Treatomancer({ povSeat, seatCount, stored, canMove }: { povSeat: number; seatCount: number; stored?: Vec2; canMove: boolean }) {
  const home = useMemo(() => machineSpot(povSeat, seatCount), [povSeat, seatCount]);
  // It faces a little to the right of the viewer's chair, toward their mat, wherever it stands.
  const look = useMemo(() => localToTable({ x: 4, y: 40 }, povSeat, seatCount), [povSeat, seatCount]);
  // Where it first appears. After that the frame loop moves it (a new prop each time would make it jump).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const start = useMemo(() => stored ?? home, []);
  const root = useRef<THREE.Group>(null);
  const lifted = useRef<THREE.Group>(null);
  const swing = useRef<THREE.Group>(null);
  const facing = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null);
  /** 0 standing … 1 held up; the swing it has from being carried about; whose machine it was last frame. */
  const lift = useRef(0);
  const dangle = useRef(0);
  const shown = useRef(`${povSeat}/${seatCount}`);
  const body = useRef<THREE.Group>(null);
  const hat = useRef<THREE.Group>(null);
  const crank = useRef<THREE.Group>(null);
  const capsules = useRef<THREE.Group>(null);
  const globeMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const halo = useRef<THREE.Sprite>(null);
  const star = useRef<THREE.Sprite>(null);
  const pupils = useRef<(THREE.Mesh | null)[]>([]);
  const lids = useRef<(THREE.Mesh | null)[]>([]);
  const bulbs = useRef<(THREE.Mesh | null)[]>([]);
  const mouth = useRef<THREE.Object3D>(null);
  const top = useRef<THREE.Object3D>(null);
  const hovered = useRef(false);
  const hoverAmt = useRef(0);
  const gl = useThree((s) => s.gl);
  const holder = useTreats((s) => s.vend?.by ?? null);
  const sign = useSignTexture();
  const pile = useMemo(() => capsulePile(), []);
  useEffect(() => void loadTreatSounds(), []);
  useEffect(() => () => void (machineAnchor.on = false), []);

  const hover = (on: boolean) => {
    hovered.current = on;
    gl.domElement.style.cursor = on ? (canMove && !showBusy() ? "grab" : "pointer") : "";
  };
  useEffect(() => () => void (hovered.current && (gl.domElement.style.cursor = "")), [gl]);

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    // Its own press: no table pan, ping or deselect underneath. A tap opens the menu; a hold or drag moves it.
    e.stopPropagation();
    pressMachine(canMove, e.nativeEvent, openVend);
  };

  useFrame(({ clock, camera }, dt) => {
    const g = body.current;
    const r = root.current;
    if (!g || !r) return;
    const still = reducedMotion();
    const t = clock.elapsedTime;
    const st = showTime();
    const now = performance.now();

    // Where it is: following the pointer while it's carried, else gliding to where it was put down (or back, after
    // a "nope"). Someone else's (watching from their seat) just stands where they left it. Another seat's machine
    // (the camera moved to it) or a new table: straight there.
    const want = canMove ? machineTarget(home, stored, now) : { ...(stored ?? home), carried: false, invalid: false };
    const key = `${povSeat}/${seatCount}`;
    const jump = still || shown.current !== key;
    shown.current = key;
    const a = jump ? 1 : 1 - Math.exp(-dt * (want.carried ? 30 : 8));
    const dx = (want.x - r.position.x) * a;
    const dz = (want.y - r.position.z) * a;
    r.position.x += dx;
    r.position.z += dz;
    if (canMove) {
      machinePos.x = r.position.x;
      machinePos.y = r.position.z;
    }
    if (facing.current) facing.current.rotation.y = Math.atan2(look.x - r.position.x, look.y - r.position.z);
    lift.current = still ? (want.carried ? 1 : 0) : lift.current + ((want.carried ? 1 : 0) - lift.current) * (1 - Math.exp(-dt * 14));
    if (lifted.current) lifted.current.position.y = LIFT_H * lift.current;
    // Held up by its hat, it swings away from the way it's moved across the screen (and sways a little held still).
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    const across = dt > 0 ? (dx * right.x + dz * right.z) / dt : 0;
    const sway = want.carried && !still ? THREE.MathUtils.clamp(-across * DANGLE_PER_SPEED, -DANGLE_MAX, DANGLE_MAX) + 0.04 * Math.sin(t * 4.2) : 0;
    dangle.current += (sway - dangle.current) * (1 - Math.exp(-dt * 6));
    if (swing.current) {
      // About the line from it to the camera, so it swings across the screen.
      toCamera.set(camera.position.x - r.position.x, 0, camera.position.z - r.position.z).normalize();
      swing.current.quaternion.setFromAxisAngle(toCamera, dangle.current);
    }
    const sh = shadow.current;
    if (sh) {
      // Its shadow stays on the felt, shrinking and fading as it goes up (and reddens over a spot it can't land on).
      sh.scale.setScalar(1 - 0.35 * lift.current);
      sh.material.opacity = 0.6 * (1 - 0.4 * lift.current) + (want.invalid ? 0.3 : 0);
      sh.material.color.copy(want.invalid ? NOPE : BLACK);
    }

    // What just happened to it: a stretch as it's picked up, a bump as it lands, a shake as it goes back.
    const since = (now - machineBeat.at) / 1000;
    const beat = canMove && !still ? machineBeat.kind : null;
    const liftHop = beat === "lift" && since < 0.35 ? Math.sin((since / 0.35) * Math.PI) : 0;
    const landBump = beat === "land" && since < 0.55 ? Math.sin((since / 0.55) * Math.PI) * (1 - since / 0.55) : 0;
    const nope = beat === "nope" && since < 0.7 ? Math.sin(since * Math.PI * 9) * (1 - since / 0.7) : 0;
    if (facing.current) facing.current.rotation.y += 0.22 * nope;

    // Showtime: rattles harder and harder until it fires, a big pop, then settles.
    let shake = 0;
    let pop = landBump;
    if (st !== null && !still) {
      if (st < BEATS.launch) shake = 0.15 + 0.85 * (st / BEATS.launch) ** 2;
      const fired = st - BEATS.launch;
      if (fired >= 0 && fired < 0.7) pop = Math.sin((fired / 0.7) * Math.PI) * (1 - fired / 0.7);
    }
    // Carried, it rattles a little too (the capsules shift about).
    if (want.carried && !still) shake = Math.max(shake, 0.12);
    const jitter = shake * 0.05;
    g.rotation.z = jitter * Math.sin(t * 47) + (still ? 0 : 0.012 * Math.sin(t * 0.9));
    g.rotation.x = jitter * Math.sin(t * 39 + 1);
    g.position.y = shake * 0.35 * Math.abs(Math.sin(t * 31));
    hoverAmt.current += ((hovered.current && st === null && !want.carried ? 1 : 0) - hoverAmt.current) * (1 - Math.exp(-dt * 10));
    const grow = 1 + LIFT_GROW * lift.current + 0.02 * hoverAmt.current;
    const squash = 1 - 0.1 * pop + 0.08 * liftHop;
    g.scale.set(grow + 0.05 * pop - 0.03 * liftHop, grow * squash + (st !== null && st > BEATS.launch - 0.25 && st < BEATS.launch ? -0.06 : 0), grow + 0.05 * pop - 0.03 * liftHop);

    // The crank spins while it winds up; the capsules tumble about.
    if (crank.current) crank.current.rotation.z -= dt * (still ? 0 : 0.3 + shake * 14);
    if (capsules.current && !still) {
      capsules.current.rotation.y += dt * (0.12 + shake * 4);
      capsules.current.position.y = shake * 0.6 * Math.sin(t * 23);
    }
    // The hat: a lazy sway, a rattle, and it flies off when it fires (and lands back on).
    if (hat.current) {
      const since = st === null ? -1 : st - BEATS.launch;
      const fly = since >= 0 && since < 0.9 && !still ? Math.sin((since / 0.9) * Math.PI) : 0;
      hat.current.position.y = CAP_Y + 1.2 + fly * 7;
      hat.current.rotation.y = fly * Math.PI * 2 * (since / 0.9);
      hat.current.rotation.z = 0.22 + (still ? 0 : 0.05 * Math.sin(t * 1.3)) + jitter * 3 * Math.sin(t * 29);
    }
    // Lights chase round the cabinet; faster in a show, in the holder's glow while someone browses.
    const busy = st !== null;
    bulbs.current.forEach((b, i) => {
      if (!b) return;
      const m = b.material as THREE.MeshStandardMaterial;
      const on = 0.5 + 0.5 * Math.sin(t * (busy ? 14 : holder ? 6 : 2.4) - i * 0.9);
      m.emissiveIntensity = 0.4 + 2.2 * on;
    });
    if (globeMat.current) {
      globeMat.current.emissive.copy(want.invalid ? NOPE : GLOBE_GLOW);
      globeMat.current.emissiveIntensity = 0.05 + 0.35 * hoverAmt.current + (busy ? 0.3 + 0.3 * Math.sin(t * 20) : holder ? 0.25 : 0) + (want.invalid ? 0.35 : 0);
    }
    if (halo.current) {
      const m = halo.current.material as THREE.SpriteMaterial;
      m.color.copy(want.invalid ? NOPE : HALO);
      m.opacity = 0.18 + 0.25 * hoverAmt.current + (busy ? 0.35 * shake + 0.6 * pop : holder ? 0.2 : 0) + (want.invalid ? 0.3 : 0);
    }
    if (star.current) {
      const k = 1 + 0.15 * Math.sin(t * 3) + 0.6 * pop;
      star.current.scale.set(3.2 * k, 3.2 * k, 1);
    }
    // Its eyes follow the camera, the treat once it's flying, or the table below while it's up in the air; a blink
    // now and then (never mid-air: it's watching where it's going).
    const gaze = new THREE.Vector3();
    if (st !== null && st > BEATS.launch) {
      const s = useTreats.getState().show;
      if (s) gaze.set(s.spec.at.x, 0, s.spec.at.y);
    } else if (lift.current > 0.3) gaze.set(r.position.x, -20, r.position.z);
    else gaze.copy(camera.position);
    pupils.current.forEach((p) => {
      if (!p?.parent) return;
      const local = p.parent.worldToLocal(gaze.clone());
      local.z = Math.max(local.z, 0.1);
      local.normalize();
      p.position.set(local.x * 0.55, local.y * 0.55, 0.85);
    });
    const blink = still || want.carried ? 0 : Math.max(0, 1 - Math.abs(((t + 1.3) % 4.2) - 0.08) / 0.08);
    lids.current.forEach((l) => {
      if (!l) return;
      l.visible = blink > 0.02;
      l.scale.set(1, Math.max(0.02, blink), 1);
    });

    // Where the next treat comes from, and where the "browsing" tag sits on screen.
    mouth.current?.getWorldPosition(mouthPos);
    machineMouth.x = mouthPos.x;
    machineMouth.y = mouthPos.y;
    machineMouth.z = mouthPos.z;
    if (top.current) {
      top.current.getWorldPosition(topPos);
      const r = gl.domElement.getBoundingClientRect();
      topPos.project(camera);
      machineAnchor.x = r.left + ((topPos.x + 1) / 2) * r.width;
      machineAnchor.y = r.top + ((1 - topPos.y) / 2) * r.height;
      machineAnchor.on = topPos.z < 1 && Math.abs(topPos.x) < 1.1 && Math.abs(topPos.y) < 1.1;
    }
  });

  const front = CAB_D / 2 + 0.02;
  return (
    <group ref={root} position={[start.x, 0, start.y]} scale={SCALE}>
      {/* A soft shadow on the felt (round, so it doesn't matter which way the machine faces). */}
      <mesh ref={shadow} rotation-x={FLAT} position-y={0.1} renderOrder={1} raycast={() => null}>
        <planeGeometry args={[CAB_W * 2, CAB_W * 2]} />
        <meshBasicMaterial map={glowTexture()} color="#000000" transparent opacity={0.6} depthWrite={false} />
      </mesh>

      {/* Lifted when it's carried, hanging (and swinging) from the crown of its hat. */}
      <group ref={lifted}>
        <group ref={swing} position-y={PIVOT_Y}>
          <group ref={facing} position-y={-PIVOT_Y}>
            <group ref={body} position-y={POST_TOP}>
              {/* The cabinet. */}
              <mesh position-y={CAB_H / 2}>
                <boxGeometry args={[CAB_W, CAB_H, CAB_D]} />
                <meshStandardMaterial {...VIOLET} />
              </mesh>
              <mesh position-y={CAB_H + 0.35}>
                <boxGeometry args={[CAB_W + 0.8, 0.7, CAB_D + 0.8]} />
                <meshStandardMaterial {...BRASS} />
              </mesh>
              <mesh position-y={0.3}>
                <boxGeometry args={[CAB_W + 0.6, 0.6, CAB_D + 0.6]} />
                <meshStandardMaterial {...BRASS} />
              </mesh>
              {/* Marquee: its name in gold, a row of chasing bulbs under it. */}
              <mesh position={[0, CAB_H - 1.9, front]}>
                <planeGeometry args={[CAB_W - 1, 3.1]} />
                <meshStandardMaterial map={sign} emissive="#ffffff" emissiveMap={sign} emissiveIntensity={0.9} roughness={0.5} />
              </mesh>
              {Array.from({ length: 9 }, (_, i) => (
                <mesh
                  key={i}
                  ref={(el) => {
                    bulbs.current[i] = el;
                  }}
                  position={[-6 + i * 1.5, CAB_H - 3.9, front + 0.15]}
                >
                  <sphereGeometry args={[0.32, 12, 8]} />
                  <meshStandardMaterial color="#fff3c4" emissive={CAPSULE_COLORS[i % CAPSULE_COLORS.length]} emissiveIntensity={1} />
                </mesh>
              ))}
              {/* Goggly eyes: it's a mimic, of course. */}
              {[-2.7, 2.7].map((x, i) => (
                <group key={x} position={[x, 4.6, front]}>
                  <mesh>
                    <circleGeometry args={[1.45, 28]} />
                    <meshStandardMaterial color="#fffaf0" roughness={0.3} emissive="#fffaf0" emissiveIntensity={0.35} />
                  </mesh>
                  <mesh position-z={-0.01}>
                    <ringGeometry args={[1.45, 1.8, 28]} />
                    <meshStandardMaterial {...BRASS} />
                  </mesh>
                  <mesh
                    ref={(el) => {
                      pupils.current[i] = el;
                    }}
                    position-z={0.05}
                  >
                    <circleGeometry args={[0.66, 20]} />
                    <meshBasicMaterial color="#14101e" />
                  </mesh>
                  <mesh
                    ref={(el) => {
                      lids.current[i] = el;
                    }}
                    position={[0, 0, 0.1]}
                  >
                    <circleGeometry args={[1.5, 28]} />
                    <meshStandardMaterial color="#47206b" />
                  </mesh>
                </group>
              ))}
              {/* Coin slot, chute and crank. */}
              <mesh position={[0, 1.9, front + 0.05]}>
                <planeGeometry args={[0.5, 1.6]} />
                <meshStandardMaterial color="#1a0f24" emissive="#ffcf5a" emissiveIntensity={0.8} />
              </mesh>
              <mesh position={[-4.4, 1.9, front - 0.4]}>
                <boxGeometry args={[3.6, 2.4, 1.2]} />
                <meshStandardMaterial color="#160b20" roughness={0.9} />
              </mesh>
              <mesh position={[-4.4, 2.9, front + 0.25]} rotation-x={0.35}>
                <boxGeometry args={[3.8, 0.9, 0.2]} />
                <meshStandardMaterial {...BRASS} />
              </mesh>
              <group ref={crank} position={[4.4, 1.9, front + 0.2]}>
                <mesh rotation-x={Math.PI / 2}>
                  <cylinderGeometry args={[1.5, 1.5, 0.4, 28]} />
                  <meshStandardMaterial {...BRASS} />
                </mesh>
                <mesh position={[0.9, 0, 0.35]} rotation-z={Math.PI / 2}>
                  <boxGeometry args={[0.35, 2.2, 0.35]} />
                  <meshStandardMaterial {...BRASS} color="#b8862e" />
                </mesh>
                <mesh position={[1.9, 0, 0.75]}>
                  <sphereGeometry args={[0.45, 14, 10]} />
                  <meshStandardMaterial color="#ff5d8f" roughness={0.35} />
                </mesh>
              </group>

              {/* The globe and what's in it. */}
              <mesh position-y={CAB_H + 1.2}>
                <cylinderGeometry args={[GLOBE_R * 0.78, GLOBE_R * 0.86, 1.2, 40]} />
                <meshStandardMaterial {...BRASS} />
              </mesh>
              <group position-y={GLOBE_Y - POST_TOP}>
                <group ref={capsules}>
                  <instancedMesh args={[undefined, undefined, pile.length]} ref={(m) => m && paintPile(m, pile)}>
                    <sphereGeometry args={[1, 16, 12]} />
                    <meshStandardMaterial roughness={0.25} metalness={0.05} />
                  </instancedMesh>
                </group>
                <mesh renderOrder={3}>
                  <sphereGeometry args={[GLOBE_R, 48, 32]} />
                  <meshPhysicalMaterial ref={globeMat} color="#dff4ff" transparent opacity={0.22} roughness={0.04} metalness={0} clearcoat={1} emissive="#b59cff" emissiveIntensity={0.05} depthWrite={false} />
                </mesh>
                <sprite ref={halo} scale={[GLOBE_R * 3.4, GLOBE_R * 3.4, 1]} renderOrder={2}>
                  <spriteMaterial map={glowTexture()} color="#c9a0ff" transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
                </sprite>
              </group>
              <mesh position-y={CAP_Y - POST_TOP + 0.5}>
                <cylinderGeometry args={[2.6, 3.4, 1.4, 32]} />
                <meshStandardMaterial {...BRASS} />
              </mesh>
              <object3D ref={mouth} position-y={CAP_Y - POST_TOP + 2} />
              {/* The hat: floppy, starry, with a glowing star on the tip. */}
              <group ref={hat} position-y={CAP_Y + 1.2 - POST_TOP} rotation-z={0.22}>
                <mesh rotation-x={FLAT}>
                  <cylinderGeometry args={[4.9, 4.9, 0.45, 40]} />
                  <meshStandardMaterial color="#2e2b8c" roughness={0.6} emissive="#100e48" emissiveIntensity={0.6} />
                </mesh>
                <mesh position-y={0.9}>
                  <cylinderGeometry args={[3.7, 3.9, 1.3, 32]} />
                  <meshStandardMaterial color="#d6a64e" metalness={0.6} roughness={0.35} />
                </mesh>
                {/* Crown, then the tip flopping over to one side. */}
                <mesh position={[0, 3.3, 0]}>
                  <cylinderGeometry args={[1.7, 3.6, 4.4, 32, 1, true]} />
                  <meshStandardMaterial color="#3a37a8" roughness={0.55} side={THREE.DoubleSide} emissive="#14125a" emissiveIntensity={0.6} />
                </mesh>
                <mesh position={[1.25, 6.55, 0]} rotation-z={-0.95}>
                  <coneGeometry args={[1.72, 4.2, 28, 1, true]} />
                  <meshStandardMaterial color="#3a37a8" roughness={0.55} side={THREE.DoubleSide} emissive="#14125a" emissiveIntensity={0.6} />
                </mesh>
                {[
                  [1.6, 2.4, 2.6],
                  [-1.9, 3.4, 1.6],
                  [0.4, 4.6, 1.4],
                  [-0.4, 2.2, -3.1],
                ].map(([x, y, z], i) => (
                  <sprite key={i} position={[x, y, z]} scale={[1.1, 1.1, 1]}>
                    <spriteMaterial map={glowTexture()} color="#fff1b0" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
                  </sprite>
                ))}
                <object3D ref={top} position={[3.2, 9, 0]} />
                <sprite ref={star} position={[3.05, 7.85, 0]} scale={[3.2, 3.2, 1]}>
                  <spriteMaterial map={glowTexture()} color="#ffd36b" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
                </sprite>
                <mesh position={[3.05, 7.85, 0]}>
                  <octahedronGeometry args={[0.7, 0]} />
                  <meshStandardMaterial color="#ffe28a" emissive="#ffb600" emissiveIntensity={1.4} />
                </mesh>
              </group>
            </group>

            {/* What you press: a column round the whole machine (the picture itself is mostly air). */}
            <mesh
              position-y={20}
              onPointerDown={down}
              onPointerOver={(e) => {
                e.stopPropagation();
                hover(true);
              }}
              onPointerOut={() => hover(false)}
            >
              <cylinderGeometry args={[8.5, 8.5, 42, 16]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

const mouthPos = new THREE.Vector3();
const topPos = new THREE.Vector3();
const right = new THREE.Vector3();
const toCamera = new THREE.Vector3();

/** Capsules heaped in the bottom of the globe: position, size and colour each (fixed, so it's the same every time). */
function capsulePile(): { p: THREE.Vector3; r: number; c: string }[] {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: { p: THREE.Vector3; r: number; c: string }[] = [];
  for (let tries = 0; tries < 900 && out.length < 34; tries++) {
    const r = 1.05 + rand() * 0.35;
    const p = new THREE.Vector3((rand() * 2 - 1) * GLOBE_R, -GLOBE_R + r + rand() * GLOBE_R * 1.15, (rand() * 2 - 1) * GLOBE_R);
    if (p.length() > GLOBE_R - r - 0.25) continue;
    if (out.some((o) => o.p.distanceTo(p) < o.r + r - 0.15)) continue;
    out.push({ p, r, c: CAPSULE_COLORS[out.length % CAPSULE_COLORS.length] });
  }
  return out;
}

function paintPile(mesh: THREE.InstancedMesh, pile: ReturnType<typeof capsulePile>) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  pile.forEach((c, i) => {
    m.compose(c.p, q, new THREE.Vector3(c.r, c.r, c.r));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, new THREE.Color(c.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** "TREATOMANCER" in gold on midnight, with stars; redrawn once the display font has loaded. */
function useSignTexture(): THREE.CanvasTexture {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 228;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  useEffect(() => {
    const draw = () => {
      const c = tex.image as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const g = ctx.createLinearGradient(0, 0, 0, c.height);
      g.addColorStop(0, "#1d1450");
      g.addColorStop(1, "#0d0a2a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = "#d6a64e";
      ctx.lineWidth = 10;
      ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(255, 240, 190, ${0.25 + ((i * 37) % 10) / 20})`;
        ctx.beginPath();
        ctx.arc(30 + ((i * 397) % 960), 26 + ((i * 131) % 176), 2 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = "800 104px Cinzel, Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "#ffb600";
      ctx.shadowBlur = 24;
      const gold = ctx.createLinearGradient(0, 60, 0, 170);
      gold.addColorStop(0, "#fff1b0");
      gold.addColorStop(1, "#e2a93b");
      ctx.fillStyle = gold;
      ctx.fillText("TREATOMANCER", c.width / 2, c.height / 2 + 6, c.width - 70);
      tex.needsUpdate = true;
    };
    draw();
    void document.fonts?.load("800 104px Cinzel").then(draw, () => {});
  }, [tex]);
  return tex;
}
