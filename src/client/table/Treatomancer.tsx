// The Treatomancer: a wizard's gumball machine on the table. A glass globe of capsules on a violet cabinet with
// goggly eyes, a marquee, a crank and a chute, under a floppy star-spangled hat. Click it for its menu
// (TreatMenu.tsx); while a show plays (treatShow.ts) it rattles, winds up and fires the capsule out of its top,
// hat and all.
//
// It stands just left of the viewer's own mat (machineSpot in shared/treats.ts), where their camera has it in view,
// so every player has their own copy: only where a treat flies *from* differs between screens, never where it
// lands or what happens after. Procedural geometry only, no model files.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { localToTable, seatAngle } from "../../shared/tableLayout";
import { glowTexture } from "./textures";
import { reducedMotion } from "./motion";
import { BEATS, machineSpot } from "../../shared/treats";
import { machineAnchor, machineMouth, showTime, useTreats } from "./treatState";
import { openVend } from "./treatShow";
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


const FLAT = -Math.PI / 2;
const BRASS = { color: "#e8b65a", metalness: 0.35, roughness: 0.32, emissive: "#3a2400", emissiveIntensity: 0.4 } as const;
const VIOLET = { color: "#7438ad", roughness: 0.42, metalness: 0.05, emissive: "#24083f", emissiveIntensity: 0.5 } as const;
const CAPSULE_COLORS = ["#ff5d8f", "#ffd84a", "#5fb8ff", "#7bd957", "#b59cff", "#ff8a2b", "#45e0ff", "#ff7ab6"];

export function Treatomancer({ povSeat, seatCount }: { povSeat: number; seatCount: number }) {
  const spot = useMemo(() => {
    const at = machineSpot(povSeat, seatCount);
    // It faces a little to the right of the viewer's chair, toward their mat.
    const look = localToTable({ x: 4, y: 40 }, povSeat, seatCount);
    return { x: at.x, z: at.y, face: Math.atan2(look.x - at.x, look.y - at.y), angle: seatAngle(povSeat, seatCount) };
  }, [povSeat, seatCount]);
  const root = useRef<THREE.Group>(null);
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
    gl.domElement.style.cursor = on ? "pointer" : "";
  };
  useEffect(() => () => void (hovered.current && (gl.domElement.style.cursor = "")), [gl]);

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    // Its own click: no table pan, ping or deselect underneath.
    e.stopPropagation();
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    openVend();
  };

  useFrame(({ clock, camera }, dt) => {
    const g = body.current;
    if (!g || !root.current) return;
    const still = reducedMotion();
    const t = clock.elapsedTime;
    const st = showTime();
    // Showtime: rattles harder and harder until it fires, a big pop, then settles.
    let shake = 0;
    let pop = 0;
    if (st !== null && !still) {
      if (st < BEATS.launch) shake = 0.15 + 0.85 * (st / BEATS.launch) ** 2;
      const since = st - BEATS.launch;
      if (since >= 0 && since < 0.7) pop = Math.sin((since / 0.7) * Math.PI) * (1 - since / 0.7);
    }
    const jitter = shake * 0.05;
    g.rotation.z = jitter * Math.sin(t * 47) + (still ? 0 : 0.012 * Math.sin(t * 0.9));
    g.rotation.x = jitter * Math.sin(t * 39 + 1);
    g.position.y = shake * 0.35 * Math.abs(Math.sin(t * 31));
    hoverAmt.current += ((hovered.current && st === null ? 1 : 0) - hoverAmt.current) * (1 - Math.exp(-dt * 10));
    const squash = 1 - 0.1 * pop;
    g.scale.set(1 + 0.05 * pop + 0.02 * hoverAmt.current, squash + 0.02 * hoverAmt.current + (st !== null && st > BEATS.launch - 0.25 && st < BEATS.launch ? -0.06 : 0), 1 + 0.05 * pop + 0.02 * hoverAmt.current);

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
    if (globeMat.current) globeMat.current.emissiveIntensity = 0.05 + 0.35 * hoverAmt.current + (busy ? 0.3 + 0.3 * Math.sin(t * 20) : holder ? 0.25 : 0);
    if (halo.current) {
      (halo.current.material as THREE.SpriteMaterial).opacity = 0.18 + 0.25 * hoverAmt.current + (busy ? 0.35 * shake + 0.6 * pop : holder ? 0.2 : 0);
    }
    if (star.current) {
      const k = 1 + 0.15 * Math.sin(t * 3) + 0.6 * pop;
      star.current.scale.set(3.2 * k, 3.2 * k, 1);
    }
    // Its eyes follow the camera, or the treat once it's flying; a blink now and then.
    const look = new THREE.Vector3();
    if (st !== null && st > BEATS.launch) {
      const s = useTreats.getState().show;
      if (s) look.set(s.spec.at.x, 0, s.spec.at.y);
    } else look.copy(camera.position);
    pupils.current.forEach((p) => {
      if (!p?.parent) return;
      const local = p.parent.worldToLocal(look.clone());
      local.z = Math.max(local.z, 0.1);
      local.normalize();
      p.position.set(local.x * 0.55, local.y * 0.55, 0.85);
    });
    const blink = still ? 0 : Math.max(0, 1 - Math.abs(((t + 1.3) % 4.2) - 0.08) / 0.08);
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
    <group ref={root} position={[spot.x, 0, spot.z]} rotation-y={spot.face} scale={SCALE}>
      {/* A soft shadow on the felt. */}
      <mesh rotation-x={FLAT} position-y={0.1} renderOrder={1}>
        <planeGeometry args={[CAB_W * 1.9, CAB_D * 2.2]} />
        <meshBasicMaterial map={glowTexture()} color="#000000" transparent opacity={0.6} depthWrite={false} />
      </mesh>

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

      {/* What you click: a column round the whole machine (the picture itself is mostly air). */}
      <mesh
        position-y={20}
        onPointerDown={down}
        onClick={click}
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
  );
}

const mouthPos = new THREE.Vector3();
const topPos = new THREE.Vector3();

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
