// A player's companion on the table (and in the lab, /dev/companion-lab): its picture on a soft shadow, an idle
// breath, hops when its player's turn starts, and on top of that whatever reaction it is playing
// (companionPlayback.ts), with its effect glyphs. It tells its speech bubble (SpeechBubbles.tsx) where its head
// is. At the table it can be tapped (a poke), its owner can right-click it for the emote wheel, and pick it up
// and carry it somewhere else (companionCarry.ts says where it is: carried, landing, or standing at its spot).
// The motion itself is pure (companionMotion.ts); this file only turns poses into sprite transforms.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { glowTexture, glyphTexture, hueTexture, spriteTexture, useImage } from "./textures";
import { reducedMotion } from "./motion";
import { hopFade } from "./petMotion";
import { advanceTrack, fxSpawns, glyphPose, newTrack, REST, type Fx, type GlyphMotion } from "./companionMotion";
import { bodyStyle, reactionFor } from "./companionReactions";
import { reactionNow, reactionOf } from "./companionPlayback";
import { bubbleAnchors } from "./companionTalk";
import { petPositions, petTarget } from "./companionCarry";
import { racePose, showBusy } from "./treatState";
import { loadVoice } from "../companionVoice";
import { useCompanionPrefs } from "../companionPrefs";
import { companionArt, companionDef, variantHue } from "../roster";

export const PET_SIZE = 2.8;
const FLAT = -Math.PI / 2;
/** Glyph sprites per companion, reused round-robin: four companions reacting at once draw at most 4 × this. */
export const FX_SLOTS = 8;
/** Size of a glyph, in body heights. */
const GLYPH_SIZE = 0.3;
/** The tappable part of the picture: the body, not the whole (mostly transparent) square. */
const HIT_W = 0.6;
const HIT_H = 0.82;
/** How high a carried companion is held over the table, and how much bigger it looks up there. */
const LIFT_H = 1.3;
const LIFT_GROW = 0.08;
/** Most it swings (rad) while carried, and how much a sideways speed (units/s across the screen) swings it. */
const DANGLE_MAX = 0.55;
const DANGLE_PER_SPEED = 0.035;

const WHITE = new THREE.Color("#ffffff");
const DIM = new THREE.Color("#7a7a88");
/** Held over somewhere it can't be put down. */
const NOPE_TINT = new THREE.Color("#ff8080");
const NOPE_SHADOW = new THREE.Color("#c01818");
const BLACK = new THREE.Color("#000000");

/** A glyph on screen, in one of the figure's FX_SLOTS sprites. */
interface LiveGlyph {
  fx: Fx;
  motion: GlyphMotion;
  copy: number;
  /** reactionNow() it appeared, and how long it lasts (ms). */
  born: number;
  life: number;
}

const right = new THREE.Vector3();
const up = new THREE.Vector3();

/**
 * `playerId` is whose companion this is (reactions are played per player); `at` is its home spot on the table and
 * `stored` where its player put it down instead, if they did (it glides between them, and follows a carry).
 * Offline: no idle breath or hop (it's resting), but it still reacts if someone pokes it. `onPress`: a left press
 * on it (which doesn't reach the table underneath, so no pan, ping or deselect) becomes a poke or, on your own,
 * a pick-up (companionCarry.ts); `own` shows a grab cursor for that. `onEmote`: a right-click on it opens the
 * emote wheel at the cursor instead of the table's menu (its owner only).
 */
export function CompanionFigure({ playerId, companion, variant, at, stored, active, turnNumber, offline, own, onPress, onEmote }: { playerId: string; companion: string; variant: number; at: { x: number; y: number }; stored?: { x: number; y: number }; active: boolean; turnNumber: number; offline: boolean; own?: boolean; onPress?: (e: PointerEvent) => void; onEmote?: (clientX: number, clientY: number) => void }) {
  const def = companionDef(companion);
  const url = companionArt(companion);
  const img = useImage(variant > 0 ? url : null);
  const hue = variantHue(variant);
  const tex = useMemo(() => (img && hue ? hueTexture(img, hue) : spriteTexture(url)), [url, img, hue]);
  const style = bodyStyle(companion);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const sprite = useRef<THREE.Sprite>(null);
  const shadow = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null);
  const anchor = useRef<THREE.Group>(null);
  /** 0 standing … 1 held up; and the swing it has from being moved about. */
  const lift = useRef(0);
  const dangle = useRef(0);
  const lean = useRef(0);
  // Where it first appears. Only then: after that the frame loop moves it (a new prop each time would make it jump).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const start = useMemo((): [number, number, number] => [(stored ?? at).x, 0.04, (stored ?? at).y], []);
  const glyphs = useRef<(THREE.Sprite | null)[]>([]);
  const live = useRef<(LiveGlyph | null)[]>(Array(FX_SLOTS).fill(null));
  const track = useRef(newTrack());
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const hovered = useRef(false);
  const hoverAmt = useRef(0);
  const gl = useThree((s) => s.gl);
  const hover = (on: boolean) => {
    hovered.current = on;
    gl.domElement.style.cursor = on && !showBusy() ? (own ? "grab" : "pointer") : "";
  };
  useEffect(() => () => void (hovered.current && (gl.domElement.style.cursor = "")), [gl]);
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onPress?.(e.nativeEvent);
  };
  const emote = (e: ThreeEvent<MouseEvent>) => {
    if (!onEmote) return;
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    onEmote(e.nativeEvent.clientX, e.nativeEvent.clientY);
  };
  // Its voice loads when it arrives at the table (once per companion, however many copies there are), unless
  // this player has companion sounds off: then only once they turn them on.
  const sounds = useCompanionPrefs().sounds;
  useEffect(() => {
    if (sounds) void loadVoice(companion);
  }, [companion, sounds]);
  useEffect(() => () => void petPositions.delete(playerId), [playerId]);
  // When this player's turn started (or the table opened on it), so the hopping can wind down. The turn
  // number is a dependency too: with one player at the table (solo) it's their turn again, and `active`
  // never changes, so only the number says a new turn began.
  const turnStart = useRef<number | null>(null);
  useEffect(() => {
    turnStart.current = active ? performance.now() : null;
  }, [active, turnNumber]);

  useFrame(({ clock, camera }, dt) => {
    const g = body.current;
    const s = sprite.current;
    const r = root.current;
    if (!g || !s || !r) return;
    const t = clock.elapsedTime + phase;
    const still = reducedMotion();

    // Where it is: following its carrier's pointer (closely if that's this player, smoothed if streamed in), or
    // gliding to where it was put down (or back, after a "nope"). Reduced motion: straight there.
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    // Racing for a treat (treatShow.ts): the race says exactly where it is, every frame.
    const race = racePose(playerId);
    const want = race ? { x: race.x, y: race.y, carried: null, invalid: false } : petTarget(playerId, at, stored);
    const carried = want.carried !== null;
    const k = race ? 60 : want.carried === "local" ? 30 : want.carried === "remote" ? 12 : 8;
    const a = still ? 1 : 1 - Math.exp(-dt * k);
    const dx = (want.x - r.position.x) * a;
    const dz = (want.y - r.position.z) * a;
    r.position.x += dx;
    r.position.z += dz;
    petPositions.set(playerId, { x: r.position.x, y: r.position.z });
    lift.current = still ? (carried ? 1 : 0) : lift.current + ((carried ? 1 : 0) - lift.current) * (1 - Math.exp(-dt * 14));
    // Held up, it swings away from the way it's moved across the screen, and settles when it stops.
    const across = dt > 0 ? (dx * right.x + dz * right.z) / dt : 0;
    const swing = carried && !still ? THREE.MathUtils.clamp(-across * DANGLE_PER_SPEED, -DANGLE_MAX, DANGLE_MAX) : 0;
    dangle.current += (swing - dangle.current) * (1 - Math.exp(-dt * 7));
    const sh = shadow.current;
    if (sh) {
      // Its shadow shrinks and fades as it goes up (and reddens over a spot it can't land on).
      sh.scale.setScalar(1 - 0.4 * lift.current);
      sh.material.opacity = 0.55 * (1 - 0.45 * lift.current) + (want.invalid ? 0.25 : 0);
      sh.material.color.copy(want.invalid ? NOPE_SHADOW : BLACK);
    }
    s.material.color.copy(want.invalid ? NOPE_TINT : offline ? DIM : WHITE);
    if (anchor.current) anchor.current.position.y = LIFT_H * lift.current;
    if (still || offline) {
      g.position.set(0, 0, 0);
      g.scale.set(1, 1, 1);
    } else {
      // Idle: a slow breath. Just after their turn starts: hops that ease off to rest.
      const fade = hopFade(turnStart.current === null ? null : (performance.now() - turnStart.current) / 1000);
      const hop = Math.abs(Math.sin(t * 3.2)) * 0.4 * fade;
      const breath = 1 + Math.sin(t * 1.6) * 0.018;
      g.position.set(0, hop, 0);
      g.scale.set(1 / breath, breath, 1);
    }

    // The reaction on top. A new one (or a stop) blends over from wherever the last one had got to.
    const now = reactionNow();
    const playing = reactionOf(playerId);
    const tr = track.current;
    const reaction = playing?.slot ? reactionFor(companion, playing.slot) : undefined;
    const since = playing ? (now - playing.at) / 1000 : 0;
    const moved = advanceTrack(tr, playing?.seq ?? 0, reaction, since, style, now);
    const pose = still ? REST : moved;

    // Offsets are along the screen (the picture faces the camera), so take the camera's right and up.
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    g.position.addScaledVector(right, pose.dx * PET_SIZE).addScaledVector(up, pose.dy * PET_SIZE);
    g.position.y += LIFT_H * lift.current;
    // Hovered (when it can be poked): it perks up a touch. Held up: a little bigger (nearer the eye).
    hoverAmt.current += ((hovered.current && !still && !carried ? 1 : 0) - hoverAmt.current) * 0.25;
    const perk = (1 + 0.06 * hoverAmt.current) * (still ? 1 : 1 + LIFT_GROW * lift.current);
    s.scale.set(PET_SIZE * pose.sx * perk, PET_SIZE * pose.sy * perk, 1);
    // Running: it leans into the way it's going across the screen.
    const running = race && !still && (race.state === "run" || race.state === "home");
    const runLean = running ? -THREE.MathUtils.clamp((race.dx * right.x + race.dy * right.z) * 0.22, -0.22, 0.22) : 0;
    lean.current += (runLean - lean.current) * (1 - Math.exp(-dt * 10));
    s.material.rotation = pose.rot + dangle.current + lean.current;
    s.material.opacity = pose.alpha;

    // Glyphs due since last frame take a free slot (or the oldest). Reduced motion: only each reaction's first, held still.
    if (reaction) {
      for (const sp of fxSpawns(reaction, style, tr.fxUpTo, since)) {
        if (still && (sp.index > 0 || sp.copy > 0)) continue;
        const fx = reaction.fx[sp.index];
        const slots = live.current;
        let slot = slots.findIndex((l) => !l || now - l.born >= l.life);
        if (slot < 0) slot = slots.reduce((old, l, i) => (l!.born < slots[old]!.born ? i : old), 0);
        // Dated from when it was due, not this frame: one caught up after a gap is already part-way through.
        slots[slot] = { fx, motion: still ? "still" : fx.motion, copy: sp.copy, born: playing!.at + sp.t * 1000, life: sp.life * 1000 };
        const gs = glyphs.current[slot];
        if (gs) gs.material.map = glyphTexture(fx.glyph);
        if (gs) gs.material.color.set(fx.tint ?? "#ffffff");
      }
      tr.fxUpTo = Math.max(tr.fxUpTo, since);
    }
    live.current.forEach((l, i) => {
      const gs = glyphs.current[i];
      if (!gs) return;
      const u = l ? (now - l.born) / l.life : 1;
      gs.visible = !!l && u < 1;
      if (!l || u >= 1) return;
      const gp = glyphPose(l.motion, u, l.copy, l.fx.n ?? 1);
      const size = GLYPH_SIZE * (l.fx.size ?? 1) * gp.scale * PET_SIZE;
      gs.position
        .copy(g.position)
        .addScaledVector(right, ((l.fx.x ?? 0.18) + gp.x) * PET_SIZE)
        .addScaledVector(up, (style.head + (l.fx.y ?? 0) + gp.y) * PET_SIZE);
      gs.scale.set(size, size, 1);
      gs.material.opacity = gp.alpha;
      gs.material.rotation = gp.rot;
    });
  });

  if (!def) return null;
  return (
    <group ref={root} position={start}>
      <mesh ref={shadow} rotation-x={FLAT} position-y={0.02} renderOrder={2} raycast={() => null}>
        <planeGeometry args={[PET_SIZE * 0.78, PET_SIZE * 0.34]} />
        <meshBasicMaterial map={glowTexture()} color="#000000" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <group ref={body}>
        <sprite ref={sprite} scale={[PET_SIZE, PET_SIZE, 1]} center={[0.5, 0.06]} renderOrder={6} raycast={() => null}>
          <spriteMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
        </sprite>
      </group>
      {onPress && (
        // An invisible hit area over the body at rest. It stays put while the body hops and spins (a spin lifts the
        // body to turn about its middle), so a press lands whatever it is doing; it moves with the companion when
        // it's put down elsewhere. Pressing it stops the table underneath from panning or deselecting. A
        // right-click opens its owner's emote wheel; anyone else's passes through to the table's menu.
        <sprite
          scale={[PET_SIZE * HIT_W, PET_SIZE * HIT_H, 1]}
          center={[0.5, 0.04]}
          onPointerDown={down}
          onContextMenu={emote}
          onPointerOver={(e) => {
            e.stopPropagation();
            hover(true);
          }}
          onPointerOut={() => hover(false)}
        >
          <spriteMaterial transparent opacity={0} depthWrite={false} />
        </sprite>
      )}
      <group ref={anchor}>
        <BubbleAnchor playerId={playerId} height={PET_SIZE * (style.head + 0.16)} />
      </group>
      {Array.from({ length: FX_SLOTS }, (_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            glyphs.current[i] = el;
          }}
          visible={false}
          renderOrder={7}
          raycast={() => null}
        >
          <spriteMaterial map={glyphTexture("sparkle")} transparent toneMapped={false} depthWrite={false} depthTest={false} />
        </sprite>
      ))}
    </group>
  );
}

/**
 * Where its speech bubble points: just above its head as the picture is drawn (along the screen's up, not the
 * world's: from overhead those differ), and where its feet are (for a bubble that has to go underneath), in
 * viewport pixels, every frame. The bubble itself is DOM (SpeechBubbles.tsx), so it draws over the HUD too.
 */
function BubbleAnchor({ playerId, height }: { playerId: string; height: number }) {
  const ref = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  useEffect(() => () => void bubbleAnchors.delete(playerId), [playerId]);
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    const r = gl.domElement.getBoundingClientRect();
    g.getWorldPosition(foot);
    head.copy(foot).addScaledVector(up.setFromMatrixColumn(camera.matrixWorld, 1), height);
    foot.project(camera);
    head.project(camera);
    bubbleAnchors.set(playerId, {
      x: r.left + ((head.x + 1) / 2) * r.width,
      y: r.top + ((1 - head.y) / 2) * r.height,
      footY: r.top + ((1 - foot.y) / 2) * r.height,
      on: head.z < 1,
    });
  });
  return <group ref={ref} />;
}

const head = new THREE.Vector3();
const foot = new THREE.Vector3();
