// A player's companion on the table (and in the lab, /dev/companion-lab): its picture on a soft shadow, an idle
// breath, hops when its player's turn starts, and on top of that whatever reaction it is playing
// (companionPlayback.ts), with its effect glyphs. The motion itself is pure (companionMotion.ts); this file
// only turns poses into sprite transforms.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { glowTexture, glyphTexture, hueTexture, spriteTexture, useImage } from "./textures";
import { reducedMotion } from "./motion";
import { hopFade } from "./petMotion";
import { advanceTrack, fxSpawns, glyphPose, newTrack, REST, type Fx, type GlyphMotion } from "./companionMotion";
import { bodyStyle, reactionFor } from "./companionReactions";
import { reactionNow, reactionOf } from "./companionPlayback";
import { loadVoice } from "../companionVoice";
import { companionArt, companionDef, variantHue } from "../roster";

export const PET_SIZE = 2.8;
const FLAT = -Math.PI / 2;
/** Glyph sprites per companion, reused round-robin: four companions reacting at once draw at most 4 × this. */
export const FX_SLOTS = 8;
/** Size of a glyph, in body heights. */
const GLYPH_SIZE = 0.3;

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
 * `playerId` is whose companion this is (reactions are played per player); `at` is where it stands on the table.
 * Offline: no idle breath or hop (it's resting), but it still reacts if someone pokes it.
 */
export function CompanionFigure({ playerId, companion, variant, at, active, turnNumber, offline }: { playerId: string; companion: string; variant: number; at: { x: number; y: number }; active: boolean; turnNumber: number; offline: boolean }) {
  const def = companionDef(companion);
  const url = companionArt(companion);
  const img = useImage(variant > 0 ? url : null);
  const hue = variantHue(variant);
  const tex = useMemo(() => (img && hue ? hueTexture(img, hue) : spriteTexture(url)), [url, img, hue]);
  const style = bodyStyle(companion);
  const body = useRef<THREE.Group>(null);
  const sprite = useRef<THREE.Sprite>(null);
  const glyphs = useRef<(THREE.Sprite | null)[]>([]);
  const live = useRef<(LiveGlyph | null)[]>(Array(FX_SLOTS).fill(null));
  const track = useRef(newTrack());
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  // Its voice loads when it arrives at the table (once per companion, however many copies there are).
  useEffect(() => void loadVoice(companion), [companion]);
  // When this player's turn started (or the table opened on it), so the hopping can wind down. The turn
  // number is a dependency too: with one player at the table (solo) it's their turn again, and `active`
  // never changes, so only the number says a new turn began.
  const turnStart = useRef<number | null>(null);
  useEffect(() => {
    turnStart.current = active ? performance.now() : null;
  }, [active, turnNumber]);

  useFrame(({ clock, camera }) => {
    const g = body.current;
    const s = sprite.current;
    if (!g || !s) return;
    const t = clock.elapsedTime + phase;
    const still = reducedMotion();
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
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    g.position.addScaledVector(right, pose.dx * PET_SIZE).addScaledVector(up, pose.dy * PET_SIZE);
    s.scale.set(PET_SIZE * pose.sx, PET_SIZE * pose.sy, 1);
    s.material.rotation = pose.rot;
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
    <group position={[at.x, 0.04, at.y]}>
      <mesh rotation-x={FLAT} position-y={0.02} renderOrder={2} raycast={() => null}>
        <planeGeometry args={[PET_SIZE * 0.78, PET_SIZE * 0.34]} />
        <meshBasicMaterial map={glowTexture()} color="#000000" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <group ref={body}>
        <sprite ref={sprite} scale={[PET_SIZE, PET_SIZE, 1]} center={[0.5, 0.06]} renderOrder={6} raycast={() => null}>
          <spriteMaterial map={tex} transparent toneMapped={false} depthWrite={false} color={offline ? "#7a7a88" : "#ffffff"} />
        </sprite>
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
