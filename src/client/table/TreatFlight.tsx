// The treat itself during a show (treatShow.ts): a capsule fired from the Treatomancer's top in a high arc,
// trailing sparkles, that bounces where it lands and pops open; the treat inside springs up on a glow in its own
// colour and bobs there while the companions race; then it's gulped down (or carried off in a hug) by the
// winner. Everything here is a function of the show's clock, so it's the same on every screen bar the start of
// the flight (each screen has the machine where its camera can see it).

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BEATS, LAND_AT, RACE_AT, treatDef } from "../../shared/treats";
import { glowTexture, glyphTexture, spriteTexture } from "./textures";
import { petPositions } from "./companionCarry";
import { reducedMotion } from "./motion";
import { machineMouth, showTime, useTreats, type LiveShow } from "./treatState";

/** The treat's picture on the table: its size (world units), and how long the capsule bounces before it opens. */
const TREAT_SIZE = 2.6;
const OPEN_AT = LAND_AT + 0.38;
const TRAIL = 9;
const BURST = 8;

export const treatArt = (id: string) => `/treats/${id}.webp`;

/** The treat on screen (viewport px) while it's up for grabs, for its name tag (TreatTag in TreatMenu.tsx). */
export const treatAnchor = { x: 0, y: 0, on: false };

export function TreatFlight() {
  const show = useTreats((s) => s.show);
  if (!show) return null;
  return <Flight key={show.start} show={show} />;
}

const v = new THREE.Vector3();
const easeOutBack = (u: number) => {
  const c = 2.2;
  return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
};

function Flight({ show }: { show: LiveShow }) {
  const def = treatDef(show.spec.treat);
  const color = def?.color ?? "#ffffff";
  const tex = useMemo(() => spriteTexture(treatArt(show.spec.treat)), [show.spec.treat]);
  const capsule = useRef<THREE.Group>(null);
  const topHalf = useRef<THREE.Mesh>(null);
  const bottomHalf = useRef<THREE.Mesh>(null);
  const treat = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Mesh>(null);
  const shine = useRef<THREE.Sprite>(null);
  const trail = useRef<(THREE.Sprite | null)[]>([]);
  const burst = useRef<(THREE.Sprite | null)[]>([]);
  /** Where the flight starts: the machine's top when it fired (it keeps rattling after, so pin it then). */
  const from = useRef<THREE.Vector3 | null>(null);
  const to = new THREE.Vector3(show.spec.at.x, 0.9, show.spec.at.y);

  useFrame(({ camera, gl }) => {
    const t = showTime();
    if (t === null) return;
    const still = reducedMotion();
    if (t < BEATS.launch) from.current = new THREE.Vector3(machineMouth.x, machineMouth.y, machineMouth.z);
    const a = from.current ?? new THREE.Vector3(machineMouth.x, machineMouth.y, machineMouth.z);
    const dist = Math.hypot(to.x - a.x, to.z - a.z);
    const peak = Math.max(a.y, 0) + 9 + dist * 0.16;
    const arc = (u: number, out: THREE.Vector3) => {
      out.lerpVectors(a, to, u);
      // A parabola through both ends that tops out at `peak`.
      const base = a.y + (to.y - a.y) * u;
      out.y = base + 4 * (peak - (a.y + to.y) / 2) * u * (1 - u);
      return out;
    };

    // The capsule: in the air, then bouncing, then split in two.
    const c = capsule.current;
    if (c) {
      const flying = t >= BEATS.launch && t < LAND_AT;
      const landed = t >= LAND_AT && t < OPEN_AT + 0.45;
      c.visible = flying || landed;
      if (flying) {
        const u = (t - BEATS.launch) / BEATS.flight;
        arc(still ? 1 : u, c.position);
        c.rotation.set(t * 9, t * 5, t * 7);
        c.scale.setScalar(1.25);
      } else if (landed) {
        const since = t - LAND_AT;
        const hop = since < OPEN_AT - LAND_AT ? Math.abs(Math.sin((since / (OPEN_AT - LAND_AT)) * Math.PI * 2)) * 1.2 * (1 - since / (OPEN_AT - LAND_AT)) : 0;
        c.position.set(to.x, 1.1 + (still ? 0 : hop), to.z);
        c.rotation.set(0, since * 3, 0);
        const open = Math.max(0, (t - OPEN_AT) / 0.45);
        if (topHalf.current && bottomHalf.current) {
          topHalf.current.position.set(0, open * 2.4, 0);
          topHalf.current.rotation.z = open * 1.4;
          bottomHalf.current.position.set(0, -open * 0.4, 0);
          const fade = 1 - open;
          (topHalf.current.material as THREE.MeshStandardMaterial).opacity = fade;
          (bottomHalf.current.material as THREE.MeshStandardMaterial).opacity = fade;
        }
      }
    }
    // Sparkles behind it on the way.
    trail.current.forEach((s, i) => {
      if (!s) return;
      const u = (t - BEATS.launch) / BEATS.flight - (i + 1) * 0.035;
      s.visible = !still && t >= BEATS.launch && t < LAND_AT + 0.2 && u > 0 && u < 1;
      if (!s.visible) return;
      arc(u, s.position);
      const k = 1 - i / TRAIL;
      s.scale.setScalar(1.6 * k);
      (s.material as THREE.SpriteMaterial).opacity = 0.85 * k;
    });

    // The treat: pops out, bobs, then goes to whoever won.
    const tr = treat.current;
    const plan = show.plan;
    const winnerAt = plan.winner ? petPositions.get(plan.winner) : undefined;
    let shown = 0;
    let pos = v.set(to.x, 1.35, to.z);
    if (tr) {
      const since = t - OPEN_AT;
      tr.visible = since > 0;
      if (since > 0) {
        const popIn = still ? 1 : easeOutBack(Math.min(1, since / 0.35));
        const bob = still ? 0 : 0.18 * Math.sin(t * 3.4);
        shown = 1;
        pos.set(to.x, 1.35 + bob + (t < RACE_AT ? (1 - Math.min(1, since / 0.35)) * 1.5 : 0), to.z);
        let size = TREAT_SIZE * popIn;
        const took = t - plan.takenAt;
        if (took > 0) {
          const keep = def?.kind === "keep";
          const dur = keep ? 0.8 : 0.5;
          const u = Math.min(1, took / dur);
          if (winnerAt) {
            const target = new THREE.Vector3(winnerAt.x, keep ? 2.6 : 1.4, winnerAt.y);
            pos.lerp(target, still ? 1 : u);
          }
          // A hug: a little swell first. A gulp: straight down the hatch.
          size *= keep ? (u < 0.3 ? 1 + u : 1.3 * (1 - (u - 0.3) / 0.7)) : 1 - u;
          shown = 1 - u;
          if (!plan.winner) size = TREAT_SIZE * (1 - u);
        }
        tr.position.copy(pos);
        tr.scale.set(size, size, 1);
        tr.material.rotation = still ? 0 : 0.08 * Math.sin(t * 2.1);
        tr.visible = size > 0.01;
      }
    }
    if (ring.current) {
      ring.current.visible = shown > 0;
      ring.current.position.set(to.x, 0.06, to.z);
      const k = 1 + 0.12 * Math.sin(t * 4);
      ring.current.scale.set(k * shown, k * shown, 1);
    }
    if (shine.current) {
      shine.current.visible = shown > 0;
      shine.current.position.copy(pos);
      shine.current.scale.setScalar(TREAT_SIZE * 2.1 * shown);
      (shine.current.material as THREE.SpriteMaterial).opacity = 0.55 * shown;
    }
    // A burst of sparkles as it opens.
    burst.current.forEach((s, i) => {
      if (!s) return;
      const u = (t - OPEN_AT) / 0.7;
      s.visible = u > 0 && u < 1 && !still;
      if (!s.visible) return;
      const ang = (i / BURST) * Math.PI * 2;
      const r = 3.2 * (1 - (1 - u) ** 3);
      s.position.set(to.x + Math.cos(ang) * r, 1.4 + Math.sin(ang * 2) * 0.6 + u * 1.2, to.z + Math.sin(ang) * r);
      s.scale.setScalar(1.1 * (1 - u * 0.5));
      (s.material as THREE.SpriteMaterial).opacity = 1 - u;
    });

    // Its name tag follows it on screen while it's up for grabs.
    const up = shown > 0 && t < plan.takenAt;
    if (up) {
      const r = gl.domElement.getBoundingClientRect();
      v.copy(pos);
      v.y += TREAT_SIZE * 0.75;
      v.project(camera);
      treatAnchor.x = r.left + ((v.x + 1) / 2) * r.width;
      treatAnchor.y = r.top + ((1 - v.y) / 2) * r.height;
      treatAnchor.on = v.z < 1;
    } else treatAnchor.on = false;
  });

  return (
    <group>
      <group ref={capsule} visible={false}>
        <mesh ref={topHalf} renderOrder={6}>
          <sphereGeometry args={[1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} roughness={0.2} metalness={0.1} transparent side={THREE.DoubleSide} emissive={color} emissiveIntensity={0.25} />
        </mesh>
        <mesh ref={bottomHalf} renderOrder={6}>
          <sphereGeometry args={[1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color="#f6f1ff" roughness={0.25} transparent side={THREE.DoubleSide} />
        </mesh>
      </group>
      {Array.from({ length: TRAIL }, (_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            trail.current[i] = el;
          }}
          visible={false}
          renderOrder={5}
        >
          <spriteMaterial map={glowTexture()} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
      <mesh ref={ring} rotation-x={-Math.PI / 2} visible={false} renderOrder={3}>
        <planeGeometry args={[5.5, 5.5]} />
        <meshBasicMaterial map={glowTexture()} color={color} transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <sprite ref={shine} visible={false} renderOrder={5}>
        <spriteMaterial map={glowTexture()} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={treat} visible={false} center={[0.5, 0.25]} renderOrder={8}>
        <spriteMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </sprite>
      {Array.from({ length: BURST }, (_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            burst.current[i] = el;
          }}
          visible={false}
          renderOrder={9}
        >
          <spriteMaterial map={glyphTexture("sparkle")} color={i % 2 ? color : "#fff6c8"} transparent depthWrite={false} depthTest={false} />
        </sprite>
      ))}
    </group>
  );
}
