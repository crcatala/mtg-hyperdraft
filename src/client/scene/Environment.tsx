// The world around the table (shared/scene.ts): background, fog and the light everyone plays under, plus one of
// the environments. Lights keep roughly the same strength in every environment (cards must read the same
// everywhere); only their colour shifts with the mood. The table and the cards on it never change.

import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import type { EnvironmentId } from "../../shared/scene";
import { Tavern } from "./tavern";
import { Library } from "./library";
import { Grove } from "./grove";
import { CandleBatch } from "./bits";

interface Mood {
  background: string;
  fog: [number, number];
  ambient: [string, number];
  key: [string, number];
  hemi: [string, string, number];
}

const MOODS: Record<EnvironmentId, Mood> = {
  tavern: { background: "#120b07", fog: [130, 340], ambient: ["#ffeedd", 0.85], key: ["#ffe6c8", 1.45], hemi: ["#ffd9a8", "#2a1608", 0.5] },
  library: { background: "#0a0916", fog: [130, 340], ambient: ["#ebe6ff", 0.88], key: ["#f2edff", 1.4], hemi: ["#b9a6ff", "#1a1020", 0.55] },
  grove: { background: "#0d182a", fog: [140, 420], ambient: ["#dfe8ff", 0.88], key: ["#e6edff", 1.45], hemi: ["#a6bdff", "#14261a", 0.55] },
};

export function Environment({ id, radius }: { id: EnvironmentId; radius: number }) {
  const m = MOODS[id] ?? MOODS.tavern;
  const world = useRef<THREE.Group>(null);
  useLayoutEffect(() => drawAfterTable(world.current), [id, radius]);
  return (
    <>
      <color attach="background" args={[m.background]} />
      <fog attach="fog" args={[m.background, ...m.fog]} />
      <ambientLight color={m.ambient[0]} intensity={m.ambient[1]} />
      <directionalLight position={[12, 40, 18]} color={m.key[0]} intensity={m.key[1]} />
      <hemisphereLight args={m.hemi} />
      <group ref={world}>
        <CandleBatch>{id === "library" ? <Library radius={radius} /> : id === "grove" ? <Grove radius={radius} /> : <Tavern radius={radius} />}</CandleBatch>
      </group>
    </>
  );
}

/**
 * Draws a group's solid meshes after everything else that's solid (the table, the cards), so whatever the table
 * hides (floor, rug, chair legs) fails the depth test before it's shaded instead of being shaded and then covered.
 */
export function drawAfterTable(root: THREE.Object3D | null) {
  root?.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (mat && !mat.transparent && o.renderOrder === 0) o.renderOrder = 5;
  });
}
