// Cards in flight between zones (see motion.ts): a two-sided card that eases from one anchor to
// the other along an arc, turning over mid-air when it goes from hidden to shown (or back).
// A hand anchor is a DOM card: the flight starts or ends exactly on top of it, facing the camera
// at the same on-screen size, so the hand and the 3D table hand cards to each other seamlessly.

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../store";
import { CARD_H, CARD_W } from "../../shared/tableLayout";
import { backTexture, roundedRectGeometry, useCardTexture } from "./textures";
import { useMotion, type Anchor, type Flight } from "./motion";

const GEO = roundedRectGeometry(CARD_W, CARD_H, 0.14);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const FLAT = new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2);

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function Flights() {
  const flights = useMotion((s) => s.flights);
  return (
    <>
      {flights.map((f) => (
        <FlightCard key={f.key} flight={f} />
      ))}
    </>
  );
}

interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  /** 1 when pinned to the screen (lit like the DOM card, i.e. not by the scene lights). */
  screen: number;
}

const newPose = (): Pose => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, screen: 0 });

function FlightCard({ flight: f }: { flight: Flight }) {
  const data = useStore((s) => (f.cardId ? s.cards[f.cardId] : undefined));
  const front = useCardTexture(data, f.face, data ? undefined : f.token);
  const back = useMemo(() => backTexture(), []);
  const group = useRef<THREE.Group>(null);
  const frontMat = useRef<THREE.MeshStandardMaterial>(null);
  const backMat = useRef<THREE.MeshStandardMaterial>(null);
  const { camera, size } = useThree();
  const scratch = useMemo(
    () => ({ a: newPose(), b: newPose(), flip: new THREE.Quaternion(), roll: new THREE.Quaternion(), ndc: new THREE.Vector3(), fwd: new THREE.Vector3(), dom: null as HTMLElement | null }),
    [],
  );

  const resolve = (anchor: Anchor, out: Pose) => {
    if (anchor.kind === "table") {
      out.pos.set(anchor.x, anchor.h, anchor.y);
      out.quat.setFromAxisAngle(Y, anchor.yaw).multiply(FLAT);
      out.scale = anchor.scale ?? 1;
      out.screen = 0;
      return;
    }
    let { cx, cy, w, roll } = anchor;
    if (anchor.id) {
      // Arriving in the hand: follow the (hidden) DOM card as the fan makes room for it.
      if (!scratch.dom?.isConnected) scratch.dom = document.querySelector<HTMLElement>(`.hand-card[data-hid="${CSS.escape(anchor.id)}"]`);
      const card = scratch.dom?.querySelector<HTMLElement>(".card");
      if (scratch.dom && card) {
        const r = card.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        w = card.offsetWidth || w;
        roll = (parseFloat(scratch.dom.style.getPropertyValue("--rot")) || 0) * (Math.PI / 180);
      }
    }
    // Along the ray through the card's centre, at the depth where a card is `w` pixels wide.
    const cam = camera as THREE.PerspectiveCamera;
    const dir = scratch.ndc.set(((cx - size.left) / size.width) * 2 - 1, -((cy - size.top) / size.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    const forward = cam.getWorldDirection(scratch.fwd);
    const focal = size.height / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const depth = (CARD_W * focal) / Math.max(20, w);
    out.pos.copy(cam.position).addScaledVector(dir, depth / Math.max(0.2, dir.dot(forward)));
    out.quat.copy(cam.quaternion).multiply(scratch.roll.setFromAxisAngle(Z, -roll));
    out.scale = 1;
    out.screen = 1;
  };

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const raw = (performance.now() - f.start) / f.duration;
    g.visible = !(raw < 0 && f.hideBeforeStart);
    if (!g.visible) return;
    const t = THREE.MathUtils.clamp(raw, 0, 1);
    const e = easeInOutCubic(t);
    const { a, b } = scratch;
    resolve(f.from, a);
    resolve(f.to, b);

    g.position.lerpVectors(a.pos, b.pos, e);
    g.position.y += f.arc * 4 * e * (1 - e);
    if (f.swing) {
      const s = Math.sin(Math.PI * t);
      g.position.x += f.swing.x * s;
      g.position.z += f.swing.y * s;
    }
    // Turning over happens in the middle of the trip, around the card's long edge.
    const flipFrom = f.faceFrom ? 0 : Math.PI;
    const flipTo = f.faceTo ? 0 : Math.PI;
    const flipT = THREE.MathUtils.smoothstep(t, 0.15, 0.8);
    g.quaternion.slerpQuaternions(a.quat, b.quat, e).multiply(scratch.flip.setFromAxisAngle(Y, flipFrom + (flipTo - flipFrom) * flipT));
    const scale = THREE.MathUtils.lerp(a.scale, b.scale, e) * (f.vanish ? 1 - e : 1);
    g.scale.setScalar(Math.max(0.001, scale));

    // Near the hand it's shown unlit (like the DOM card it becomes); on the table, lit like the rest.
    const k = THREE.MathUtils.lerp(a.screen, b.screen, e);
    for (const m of [frontMat.current, backMat.current]) {
      if (!m) continue;
      m.color.setScalar(1 - k);
      m.emissiveIntensity = k;
      if (f.vanish) m.opacity = 1 - e;
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh geometry={GEO} renderOrder={6}>
        <meshStandardMaterial ref={frontMat} map={front} emissiveMap={front} emissive="#ffffff" emissiveIntensity={0} transparent={f.vanish} roughness={f.foil ? 0.25 : 0.5} metalness={f.foil ? 0.35 : 0} />
      </mesh>
      <mesh geometry={GEO} rotation-y={Math.PI} renderOrder={6}>
        <meshStandardMaterial ref={backMat} map={back} emissiveMap={back} emissive="#ffffff" emissiveIntensity={0} transparent={f.vanish} roughness={0.55} />
      </mesh>
    </group>
  );
}
