// The sealed booster, in 3D. A foil pack hangs in the middle of the draft table: it drops in, catches
// the light as the pointer moves, and is torn open by dragging across the top (or by a click / Space,
// which tears it for you). The strip peels away behind the tear front, light leaks out of the mouth,
// and on the last inch the strip flies off, a flash rips through and the cards slide out, which is
// where the DOM takes over and deals them.
//
// Everything is drawn here (canvas textures, procedural geometry, a generated room environment for
// the foil's reflections): no model or image files.

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { sfx, type TearVoice } from "../sfx";
import { useTheme } from "../theme";
import { backTexture, glowTexture } from "../table/textures";
import { buildPackArt, type PackArt, type PackLabel } from "./packArt";
import { buildFace, frontX, openMouth, peelStrip } from "./packMesh";
import { HALF_H, PACK_H, PACK_W, TEAR_Y, buildPeelPath, smoothstep } from "./packShape";
import { COMMIT_AT, FINISH_AT, autoStep, dirFromGrab, progressAt, soundSpeed, stepFront, type TearDir } from "./tearGesture";

const FOV = 30;
const MOUTH_OPEN = 0.13;
/** Seconds after the tear completes that the effects are fully played out. */
const BURST_S = 0.95;
/** The hidden stack of cards only reaches down through the full-thickness part of the body. */
const STACK_H = 2.6;

export interface PackSceneProps {
  label: PackLabel;
  /** Bump to tear the pack by itself (a click beside it, or Space). */
  openSignal: number;
  /** False once the pack is committed to opening; it then ignores the pointer. */
  interactive: boolean;
  /** The strip has come away and the cards are out: start dealing. */
  onTorn: () => void;
  /** Every effect has finished; the canvas can go. */
  onDone: () => void;
}

export default function PackScene(props: PackSceneProps) {
  const theme = useTheme();
  // Open requests made before this pack was mounted (for an earlier pack) don't count.
  const firstSignal = useRef(props.openSignal).current;
  const [art, setArt] = useState<PackArt | null>(null);
  // The art is built outside the canvas, so a failure there wouldn't reach PackBoundary by itself
  // (and the pack would never appear, leaving nothing to open). It's rethrown while rendering below.
  const [failure, setFailure] = useState<Error | null>(null);
  const { brand, name, meta } = props.label;
  useEffect(() => {
    let dead = false;
    let built: PackArt | null = null;
    buildPackArt({ brand, name, meta }, theme).then(
      (a) => {
        if (dead) return a.dispose();
        built = a;
        setArt(a);
      },
      (e: unknown) => {
        if (!dead) setFailure(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      dead = true;
      built?.dispose();
    };
  }, [brand, name, meta, theme]);

  if (failure) throw failure;

  return (
    <Canvas
      className="pack3d-canvas"
      dpr={[1, 2]}
      camera={{ fov: FOV, near: 0.5, far: 80, position: [0, 0.4, 14] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
        gl.setClearColor(0x000000, 0);
      }}
    >
      {art && <Rig art={art} firstSignal={firstSignal} {...props} />}
    </Canvas>
  );
}

// --- small helpers -------------------------------------------------------------------------------

const easeOutBack = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

function rayTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.translate(256, 256);
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 0.05 + ((i * 7) % 5) * 0.012;
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * 256, Math.sin(a) * 256);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 256, a - w, a + w);
    ctx.closePath();
    ctx.fill();
  }
  // Fade everything out toward the rim so the plane never shows an edge.
  ctx.globalCompositeOperation = "destination-in";
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, 256);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.35, "rgba(0,0,0,0.85)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(-256, -256, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Card-edge stripes for the sides of the stack of cards inside the pack. */
function paperEdge(vertical: boolean): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#eee8d6";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "rgba(90,80,60,0.45)";
  for (let i = 0; i < 64; i += 4) (vertical ? ctx.fillRect(i, 0, 1.4, 64) : ctx.fillRect(0, i, 64, 1.4));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

interface Particles {
  points: THREE.Points;
  pos: Float32Array;
  col: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  max: Float32Array;
  base: Float32Array;
  next: number;
}

function makeParticles(count: number, size: number, tex: THREE.Texture): Particles {
  const pos = new Float32Array(count * 3).fill(999);
  const col = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
  const mat = new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, pos, col, vel: new Float32Array(count * 3), life: new Float32Array(count), max: new Float32Array(count), base: new Float32Array(count * 3), next: 0 };
}

function emit(p: Particles, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color) {
  const i = p.next;
  p.next = (p.next + 1) % p.life.length;
  p.pos.set([x, y, z], i * 3);
  p.vel.set([vx, vy, vz], i * 3);
  p.base.set([color.r, color.g, color.b], i * 3);
  p.life[i] = p.max[i] = life;
}

function stepParticles(p: Particles, dt: number, drag: number, gravity: number) {
  const n = p.life.length;
  for (let i = 0; i < n; i++) {
    if (p.life[i] <= 0) {
      p.col[i * 3] = p.col[i * 3 + 1] = p.col[i * 3 + 2] = 0;
      continue;
    }
    p.life[i] -= dt;
    const k = Math.max(0, p.life[i] / p.max[i]);
    const damp = Math.exp(-drag * dt);
    p.vel[i * 3] *= damp;
    p.vel[i * 3 + 1] = p.vel[i * 3 + 1] * damp - gravity * dt;
    p.vel[i * 3 + 2] *= damp;
    for (let a = 0; a < 3; a++) {
      p.pos[i * 3 + a] += p.vel[i * 3 + a] * dt;
      p.col[i * 3 + a] = p.base[i * 3 + a] * k ** 1.4;
    }
  }
  (p.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (p.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
}

// --- the rig -------------------------------------------------------------------------------------

interface State {
  t: number;
  // intro spring
  y: number;
  vy: number;
  rz: number;
  vrz: number;
  landed: boolean;
  squash: number;
  // pointer
  px: number;
  py: number;
  tiltX: number;
  tiltY: number;
  hover: boolean;
  hoverAmt: number;
  lastHoverSound: number;
  // tearing
  p: number;
  lastP: number;
  target: number;
  dir: TearDir | 0;
  dragging: boolean;
  moved: boolean;
  downAt: number;
  downX: number;
  downY: number;
  auto: boolean;
  sampleTear: boolean;
  speed: number;
  voice: TearVoice | null;
  idle: number;
  dirty: boolean;
  // after the tear
  committed: boolean;
  tc: number;
  done: boolean;
  stripVel: THREE.Vector3;
  stripSpin: THREE.Vector3;
}

function Rig({ art, firstSignal, openSignal, interactive, onTorn, onDone }: PackSceneProps & { art: PackArt; firstSignal: number }) {
  const { gl, scene, camera, size } = useThree();
  const theme = art.palette;
  const glowColor = useMemo(() => new THREE.Color(theme.glow), [theme]);

  const faces = useMemo(() => ({ bodyF: buildFace("body", 1), bodyB: buildFace("body", -1), stripF: buildFace("strip", 1), stripB: buildFace("strip", -1) }), []);
  useEffect(() => () => Object.values(faces).forEach((f) => f.geo.dispose()), [faces]);

  const mats = useMemo(() => {
    const mk = (map: THREE.Texture, orm: THREE.Texture, normal: THREE.Texture) =>
      new THREE.MeshPhysicalMaterial({
        map,
        roughnessMap: orm,
        metalnessMap: orm,
        normalMap: normal,
        normalScale: new THREE.Vector2(1, 1),
        roughness: 1,
        metalness: 1,
        clearcoat: 0.5,
        clearcoatRoughness: 0.22,
        iridescence: 0.22,
        iridescenceIOR: 1.6,
        envMapIntensity: 1.15,
        side: THREE.DoubleSide,
      });
    return { front: mk(art.front, art.frontOrm, art.frontNormal), back: mk(art.back, art.backOrm, art.backNormal) };
  }, [art]);
  useEffect(() => () => (mats.front.dispose(), mats.back.dispose()), [mats]);

  // The stack of cards inside, only ever seen through the torn mouth.
  const stack = useMemo(() => {
    const back = backTexture();
    const sideX = paperEdge(true);
    const sideY = paperEdge(false);
    const clip = new THREE.Plane();
    const face = (m: THREE.Texture) => new THREE.MeshStandardMaterial({ map: m, roughness: 0.6, metalness: 0, clippingPlanes: [clip] });
    const mk = (tex: THREE.Texture) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, clippingPlanes: [clip] });
    const materials = [mk(sideX), mk(sideX), mk(sideY), mk(sideY), face(back), face(back)];
    const geo = new THREE.BoxGeometry(PACK_W * 0.82, STACK_H, 0.2);
    return { geo, materials, clip, dispose: () => (geo.dispose(), materials.forEach((m) => m.dispose()), sideX.dispose(), sideY.dispose()) };
  }, []);
  useEffect(() => () => stack.dispose(), [stack]);

  // Room-lit reflections for the foil.
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.03).texture;
    scene.environment = env;
    scene.environmentIntensity = 1;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
      room.dispose();
    };
  }, [gl, scene]);

  const glow = useMemo(() => glowTexture(), []);
  const rays = useMemo(() => rayTexture(), []);
  useEffect(() => () => rays.dispose(), [rays]);
  const sparks = useMemo(() => makeParticles(420, 0.16, glow), [glow]);
  const dust = useMemo(() => makeParticles(70, 0.09, glow), [glow]);
  useEffect(
    () => () => {
      for (const p of [sparks, dust]) {
        p.points.geometry.dispose();
        (p.points.material as THREE.Material).dispose();
      }
    },
    [sparks, dust],
  );

  const stackBaseY = TEAR_Y - 0.05 - STACK_H / 2;
  const hitGeo = useMemo(() => new THREE.PlaneGeometry(PACK_W * 1.08, PACK_H * 1.05), []);
  useEffect(() => () => hitGeo.dispose(), [hitGeo]);

  const pack = useRef<THREE.Group>(null!);
  const bodyGroup = useRef<THREE.Group>(null!);
  const stripGroup = useRef<THREE.Group>(null!);
  const stackMesh = useRef<THREE.Mesh>(null!);
  const lightBar = useRef<THREE.Mesh>(null!);
  const frontGlow = useRef<THREE.Sprite>(null!);
  const hintGlow = useRef<THREE.Sprite>(null!);
  const leak = useRef<THREE.PointLight>(null!);
  const flash = useRef<THREE.Sprite>(null!);
  const rayMesh = useRef<THREE.Mesh>(null!);
  const shadow = useRef<THREE.Mesh>(null!);
  const key = useRef<THREE.DirectionalLight>(null!);

  const S = useRef<State>({
    t: 0,
    y: 5.8,
    vy: 0,
    rz: -0.5,
    vrz: 0,
    landed: false,
    squash: 0,
    px: 0,
    py: 0,
    tiltX: 0,
    tiltY: 0,
    hover: false,
    hoverAmt: 0,
    lastHoverSound: -9,
    p: 0,
    lastP: 0,
    target: 0,
    dir: 0,
    dragging: false,
    moved: false,
    downAt: 0,
    downX: 0,
    downY: 0,
    auto: false,
    sampleTear: false,
    speed: 0,
    voice: null,
    idle: 0,
    dirty: true,
    committed: false,
    tc: 0,
    done: false,
    stripVel: new THREE.Vector3(),
    stripSpin: new THREE.Vector3(),
  });
  const cb = useRef({ onTorn, onDone, interactive });
  cb.current = { onTorn, onDone, interactive };

  // Frame the pack: big enough to feel like an object, with room for the tilt and the burst.
  useEffect(() => {
    const aspect = size.width / size.height;
    const needH = Math.max(PACK_H / 0.68, PACK_W / 0.6 / aspect);
    const dist = needH / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.position.set(0, 0.55, dist);
    camera.lookAt(0, -0.05, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  // --- input ---
  const toLocal = useMemo(() => {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane();
    const normal = new THREE.Vector3();
    const origin = new THREE.Vector3();
    const hit = new THREE.Vector3();
    return (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      pack.current.updateWorldMatrix(true, false);
      normal.set(0, 0, 1).transformDirection(pack.current.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(normal, pack.current.getWorldPosition(origin));
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return pack.current.worldToLocal(hit);
    };
  }, [gl, camera]);

  const startAuto = () => {
    const s = S.current;
    if (s.committed || s.auto) return;
    if (s.dir === 0) s.dir = 1;
    s.auto = true;
    // A tear that began as a drag already has its rip going; otherwise play the whole rip sound.
    if (!s.voice) {
      s.sampleTear = true;
      sfx.tearAuto();
    }
  };

  // Space / a click on the page.
  const lastSignal = useRef(firstSignal);
  useEffect(() => {
    if (openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    if (cb.current.interactive) startAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // The pointer tilts the pack even when it isn't over it; a drag anywhere on it tears.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      const s = S.current;
      s.px = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.2, 1.2);
      s.py = THREE.MathUtils.clamp(-((e.clientY - r.top) / r.height) * 2 + 1, -1.2, 1.2);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [gl]);

  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(
    () => () => {
      S.current.voice?.end(false);
      gl.domElement.style.cursor = "";
    },
    [gl],
  );

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const s = S.current;
    if (s.committed || !cb.current.interactive) return;
    e.stopPropagation();
    const ev = e.nativeEvent;
    s.dragging = true;
    s.moved = false;
    s.downAt = performance.now();
    s.downX = ev.clientX;
    s.downY = ev.clientY;
    const grab = toLocal(ev.clientX, ev.clientY);
    if (s.dir === 0 && grab) s.dir = dirFromGrab(grab.x);
    gl.domElement.style.cursor = "grabbing";

    const move = (m: PointerEvent) => {
      if (s.committed) return;
      const dx = m.clientX - s.downX;
      if (Math.hypot(dx, m.clientY - s.downY) > 7) s.moved = true;
      if (s.dir === 0 && Math.abs(dx) > 8) s.dir = dx > 0 ? 1 : -1;
      if (s.dir === 0) return;
      const local = toLocal(m.clientX, m.clientY);
      if (local) s.target = Math.max(s.target, progressAt(local.x, s.dir));
    };
    const up = () => {
      cleanup();
      s.dragging = false;
      gl.domElement.style.cursor = s.hover ? "grab" : "";
      if (s.committed) return;
      const quick = performance.now() - s.downAt < 450;
      if ((!s.moved && quick) || s.target >= FINISH_AT || s.p >= FINISH_AT) startAuto();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragCleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    dragCleanup.current = cleanup;
  };

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), c: new THREE.Color(), white: new THREE.Color("#fff6dc") }), []);

  const commit = () => {
    const s = S.current;
    s.committed = true;
    s.tc = 0;
    s.p = 1;
    s.dirty = true;
    s.voice?.end(true);
    s.voice = null;
    sfx.packBurst();
    window.setTimeout(() => sfx.cardsSlide(), 130);
    const d = s.dir || 1;
    s.stripVel.set(d * 3.4, 4.2, 2.6);
    s.stripSpin.set(2.2, d * -2.6, d * 5.5);
    // The burst: a ring of sparks thrown out from the mouth.
    const origin = pack.current.localToWorld(tmp.v.set(0, TEAR_Y - 0.15, 0.2)).clone();
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.8 + 0.2;
      const sp = 2 + Math.random() * 7.5;
      tmp.c.copy(Math.random() < 0.45 ? tmp.white : glowColor);
      emit(sparks, origin.x + (Math.random() - 0.5) * PACK_W * 0.7, origin.y, origin.z, Math.cos(a) * sp, up * sp * 1.1, Math.sin(a) * sp * 0.6 + 1.5, 0.5 + Math.random() * 0.6, tmp.c);
    }
    cb.current.onTorn();
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const s = S.current;
    s.t += dt;
    const t = s.t;

    // --- the tear ---
    if (!s.committed) {
      const before = s.p;
      if (s.auto) s.p = autoStep(s.p, dt);
      else if (s.dragging && s.dir !== 0) s.p = stepFront(s.p, s.target, dt);
      s.speed += ((s.p - before) / dt - s.speed) * Math.min(1, dt * 14);
      if (s.p !== before) s.dirty = true;
      if (s.p > 0.015 && !s.voice && !s.sampleTear && s.landed) s.voice = sfx.tearStart();
      s.voice?.update(soundSpeed(s.speed));
      s.idle = s.p > 0 || s.dragging ? 0 : s.idle + dt;
      if (s.p >= COMMIT_AT) commit();
    } else s.tc += dt;
    const tc = s.tc;

    // --- deform ---
    if (s.dirty) {
      s.dirty = false;
      const dir: TearDir = s.dir || 1;
      const path = buildPeelPath(1.0 + 1.15 * smoothstep(0, 0.55, s.p), 1.05 + 0.5 * s.p);
      peelStrip(faces.stripF, s.p, dir, path, t);
      peelStrip(faces.stripB, s.p, dir, path, t);
      const open = MOUTH_OPEN * smoothstep(0, 0.12, s.p);
      openMouth(faces.bodyF, s.p, dir, open);
      openMouth(faces.bodyB, s.p, dir, open);
    }
    // The flap keeps trembling while it hangs from the front.
    if (s.p > 0.02 && !s.committed) s.dirty = true;

    const dir: TearDir = s.dir || 1;
    const fx = frontX(s.p, dir);

    // --- intro + idle motion ---
    if (!s.committed) {
      const k = 105;
      const c = 15.5;
      s.vy += (-k * s.y - c * s.vy) * dt;
      s.y += s.vy * dt;
      s.vrz += (-70 * s.rz - 11 * s.vrz) * dt;
      s.rz += s.vrz * dt;
      if (!s.landed && s.y <= 0.03 && s.vy < 0) {
        s.landed = true;
        s.squash = 1;
        sfx.packLand();
        for (let i = 0; i < 28; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 1 + Math.random() * 2.4;
          tmp.c.copy(glowColor).multiplyScalar(0.7);
          emit(sparks, Math.cos(a) * 1.2, -HALF_H + 0.1, Math.sin(a) * 0.6, Math.cos(a) * sp, 0.4 + Math.random() * 0.8, Math.sin(a) * sp * 0.4, 0.5 + Math.random() * 0.4, tmp.c);
        }
      }
    }
    s.squash *= Math.exp(-9 * dt);
    s.hoverAmt += ((s.hover || s.dragging ? 1 : 0) - s.hoverAmt) * Math.min(1, dt * 10);
    const calm = s.committed ? 0 : 1;
    // While it's being torn the pack stays put under the player's hand. (Dragging across the top
    // puts the pointer above the pack, which would tilt the foil into the overhead light and wash
    // out its face at the best moment.)
    const hold = s.dragging || s.p > 0.02 ? 0.25 : 1;
    s.tiltY = THREE.MathUtils.damp(s.tiltY, s.px * 0.42 * calm * hold, 6, dt);
    s.tiltX = THREE.MathUtils.damp(s.tiltX, -s.py * 0.3 * calm * hold, 6, dt);
    const bob = Math.sin(t * 1.35) * 0.055 * calm;
    const sway = Math.sin(t * 0.7) * 0.07 * calm;
    const shake = (s.committed ? Math.max(0, 1 - tc / 0.3) * 0.08 : Math.min(1, s.speed / 2) * 0.03) * (Math.random() - 0.5) * 2;
    const g = pack.current;
    g.position.set(shake, s.y + bob, 0);
    g.rotation.set(s.tiltX + Math.sin(t * 1.1) * 0.02 * calm, s.tiltY + sway, s.rz - dir * 0.06 * Math.min(1, s.speed / 2) * (s.committed ? 0 : 1));
    const pop = 1 + 0.035 * s.hoverAmt + (s.committed ? 0.05 * Math.max(0, 1 - tc / 0.25) : 0);
    g.scale.set(pop * (1 + 0.05 * s.squash), pop * (1 - 0.06 * s.squash), pop);

    // --- lighting ---
    scene.environmentRotation.y = t * 0.16 + s.tiltY * 0.9;
    scene.environmentRotation.x = s.tiltX * 0.4;
    key.current.position.set(3 + s.px * 3, 5 + s.py * 2, 7);

    // --- tear front effects ---
    const torn = s.p;
    const cutY = TEAR_Y;
    lightBar.current.visible = torn > 0.01 && tc < 0.6;
    if (lightBar.current.visible) {
      const len = torn * PACK_W;
      lightBar.current.position.set(dir * (-PACK_W / 2 + len / 2), cutY - 0.08, 0);
      lightBar.current.scale.set(len + 0.7, 0.6 + 0.6 * torn, 1);
      (lightBar.current.material as THREE.MeshBasicMaterial).opacity = (0.35 + 0.65 * smoothstep(0, 0.6, torn)) * (1 - smoothstep(0.15, 0.6, tc));
    }
    const fg = frontGlow.current;
    fg.visible = torn > 0.01 && !s.committed;
    if (fg.visible) {
      fg.position.set(fx, cutY, 0.25);
      const sz = 0.7 + Math.min(1, s.speed / 2) * 0.8;
      fg.scale.set(sz, sz, 1);
      (fg.material as THREE.SpriteMaterial).opacity = 0.55 + 0.4 * Math.min(1, s.speed / 1.6);
      // Flecks of foil flying off the tear.
      const n = Math.round(Math.min(1, s.speed / 1.4) * 3.5 + (Math.random() < 0.3 ? 1 : 0));
      const wp = g.localToWorld(tmp.v.set(fx, cutY, 0.2));
      for (let i = 0; i < n; i++) {
        tmp.c.copy(Math.random() < 0.5 ? tmp.white : glowColor);
        emit(sparks, wp.x, wp.y, wp.z, -dir * (0.5 + Math.random() * 2) + (Math.random() - 0.5), 0.8 + Math.random() * 2.2, 1 + Math.random() * 1.6, 0.35 + Math.random() * 0.45, tmp.c);
      }
    }
    const lk = leak.current;
    lk.position.set(dir * (-PACK_W / 2 + (torn * PACK_W) / 2), cutY - 0.2, 0.55);
    lk.intensity = torn > 0.01 ? (4 + 20 * smoothstep(0, 0.9, torn)) * (s.committed ? Math.max(0, 1 - tc / 0.3) : 1) : 0;

    // A dot slides along the tear line when nobody has touched the pack for a moment.
    const hg = hintGlow.current;
    const hint = s.landed && s.idle > 3.2 && !s.committed ? Math.min(1, (s.idle - 3.2) / 0.6) : 0;
    hg.visible = hint > 0;
    if (hg.visible) {
      const u = ((s.idle - 3.2) % 2.4) / 2.4;
      const e = u * u * (3 - 2 * u);
      hg.position.set(-PACK_W / 2 + 0.25 + e * (PACK_W - 0.5), cutY + 0.12, 0.3);
      (hg.material as THREE.SpriteMaterial).opacity = hint * Math.sin(u * Math.PI) * 0.95;
      const hs = 0.45 + 0.15 * Math.sin(u * Math.PI);
      hg.scale.set(hs, hs, 1);
    }

    // --- after the tear ---
    const sg = stripGroup.current;
    const bg = bodyGroup.current;
    const st = stackMesh.current;
    const fl = flash.current;
    const ry = rayMesh.current;
    if (s.committed) {
      // The strip flies off.
      s.stripVel.y -= 12 * dt;
      sg.position.addScaledVector(s.stripVel, dt);
      sg.rotation.x += s.stripSpin.x * dt;
      sg.rotation.y += s.stripSpin.y * dt;
      sg.rotation.z += s.stripSpin.z * dt;
      // The empty wrapper slips away downward while the cards come up out of it.
      const fall = smoothstep(0.12, 0.62, tc);
      bg.position.y = -3.6 * fall * fall;
      bg.rotation.z = -dir * 0.22 * fall;
      const fade = 1 - smoothstep(0.2, 0.46, tc);
      for (const m of [mats.front, mats.back]) {
        m.transparent = true;
        m.opacity = fade;
      }
      st.visible = true;
      st.position.y = stackBaseY + 1.35 * easeOutBack(Math.min(1, tc / 0.42));
      st.rotation.z = dir * 0.05 * Math.min(1, tc / 0.4);
      const sf = 1 - smoothstep(0.42, 0.66, tc);
      for (const m of stack.materials) {
        m.transparent = true;
        m.opacity = sf;
      }
      st.scale.setScalar(1 + 0.12 * (1 - sf));
      // Flash and rays.
      fl.visible = true;
      const fs = 5 + 13 * Math.min(1, tc / 0.5);
      fl.scale.set(fs, fs, 1);
      (fl.material as THREE.SpriteMaterial).opacity = Math.min(1, tc / 0.04) * (1 - smoothstep(0.05, 0.7, tc)) * 0.95;
      ry.visible = true;
      ry.rotation.z = t * 0.6;
      const rs = 7.5 + 2.5 * tc;
      ry.scale.set(rs, rs, 1);
      (ry.material as THREE.MeshBasicMaterial).opacity = Math.min(1, tc / 0.08) * (1 - smoothstep(0.1, BURST_S, tc)) * 0.55;
      if (tc > BURST_S && !s.done) {
        s.done = true;
        cb.current.onDone();
      }
    } else {
      fl.visible = false;
      ry.visible = false;
      // The cards sit inside, clipped to the torn part so they never poke through the front.
      st.visible = torn > 0.01;
      st.position.y = stackBaseY + 0.06 * smoothstep(0, 0.6, torn);
      sg.position.set(0, 0, 0);
      sg.rotation.set(0, 0, 0);
    }
    // Keep the clip plane on the torn side of the front, in world space.
    if (!s.committed || tc < 0.05) {
      stack.clip.set(tmp.v.set(-dir, 0, 0), dir * fx);
      stack.clip.applyMatrix4(g.matrixWorld);
    } else {
      stack.clip.set(tmp.v.set(0, 0, 1), 1000);
    }

    // The shadow shrinks and fades as the pack lifts.
    const sh = shadow.current;
    const lift = Math.max(0, s.y + bob) + (s.committed ? 4 * smoothstep(0, 0.5, tc) : 0);
    sh.scale.setScalar(1 - Math.min(0.5, lift * 0.06));
    (sh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 - lift * 0.05) * (s.committed ? 1 - smoothstep(0.1, 0.5, tc) : 1) * (s.landed ? 1 : 0.4);

    // Ambient glitter around the pack, and the particle systems.
    if (!s.committed && Math.random() < dt * 14) {
      tmp.c.copy(Math.random() < 0.5 ? tmp.white : glowColor).multiplyScalar(0.8);
      emit(dust, (Math.random() - 0.5) * 4.4, -2.2 + Math.random() * 4.4, -0.5 + Math.random() * 1.6, (Math.random() - 0.5) * 0.15, 0.12 + Math.random() * 0.22, 0, 2 + Math.random() * 2.5, tmp.c);
    }
    stepParticles(dust, dt, 0.2, 0);
    stepParticles(sparks, dt, 2.2, 6);
  });

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight ref={key} intensity={2.1} color="#fff1dc" position={[3, 5, 7]} />
      <directionalLight intensity={1.6} color={theme.rim} position={[-6, 2, -3]} />
      <directionalLight intensity={0.7} color="#ffffff" position={[-4, -3, 5]} />
      <pointLight ref={leak} color={theme.glow} distance={5} decay={1.6} intensity={0} />

      {/* soft contact shadow under the pack */}
      <mesh ref={shadow} position={[0, -HALF_H - 0.55, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={1}>
        <planeGeometry args={[4.6, 2.2]} />
        <meshBasicMaterial map={glow} color="#000" transparent opacity={0.5} depthWrite={false} />
      </mesh>

      {/* rays and flash behind/over everything when the pack opens */}
      <mesh ref={rayMesh} position={[0, 0.2, -1.5]} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={rays} color={theme.glow} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <sprite ref={flash} position={[0, 0.6, 1.4]} visible={false}>
        <spriteMaterial map={glow} color="#fff3d6" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={false} />
      </sprite>

      <group ref={pack}>
        <group ref={bodyGroup}>
          <mesh geometry={faces.bodyF.geo} material={mats.front} />
          <mesh geometry={faces.bodyB.geo} material={mats.back} />
        </group>
        <group ref={stripGroup}>
          <mesh geometry={faces.stripF.geo} material={mats.front} />
          <mesh geometry={faces.stripB.geo} material={mats.back} />
        </group>
        <mesh ref={stackMesh} geometry={stack.geo} material={stack.materials} position={[0, stackBaseY, -0.0]} visible={false} renderOrder={-1} />
        <mesh ref={lightBar} visible={false}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={glow} color={theme.glow} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <sprite ref={frontGlow} visible={false}>
          <spriteMaterial map={glow} color={theme.glow} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={false} />
        </sprite>
        <sprite ref={hintGlow} visible={false}>
          <spriteMaterial map={glow} color="#ffffff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={false} />
        </sprite>
        <mesh
          geometry={hitGeo}
          position={[0, 0, 0.05]}
          onPointerDown={onDown}
          onPointerOver={() => {
            const s = S.current;
            if (s.committed || !cb.current.interactive) return;
            s.hover = true;
            if (!s.dragging) gl.domElement.style.cursor = "grab";
            if (s.t - s.lastHoverSound > 0.6 && s.landed) {
              s.lastHoverSound = s.t;
              sfx.packHover();
            }
          }}
          onPointerOut={() => {
            S.current.hover = false;
            if (!S.current.dragging) gl.domElement.style.cursor = "";
          }}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <primitive object={sparks.points} />
      <primitive object={dust.points} />
    </>
  );
}
