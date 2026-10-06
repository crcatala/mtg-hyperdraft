// The title screen's backdrop: a table set for a game (piles, a spread of cards, a d20) in one of the
// environments, with the camera slowly circling it. Each UI theme gets its own pairing (titleScenes.ts), so the
// backdrop matches the menus. No WebGL: nothing is drawn and Home keeps its plain background. Reduced motion: the
// camera holds still (the scene's own small motions hold too).

import { Component, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ThemeId } from "../theme";
import { CARD_H, CARD_W, tableRadius } from "../../shared/tableLayout";
import { Environment } from "./Environment";
import { TableModel } from "./tables";
import { WhenSlow } from "./bits";
import { backTexture, roundedRectGeometry } from "../table/textures";
import { reducedMotion } from "../table/motion";
import { canUse3d } from "../pack/support";
import { seeded } from "./sceneTextures";
import { TITLE_SCENES } from "./titleScenes";

/** Two players' worth of table: big enough to look like a game, small enough to frame. */
const SEATS = 2;

export function TitleBackdrop({ theme }: { theme: ThemeId }) {
  const [failed, setFailed] = useState(false);
  const [dpr, setDpr] = useState<number | [number, number]>([1, 1.5]);
  if (failed || !canUse3d()) return null;
  const { env, table } = TITLE_SCENES[theme] ?? TITLE_SCENES.gamenight;
  const radius = tableRadius(SEATS);
  return (
    <div className="home-scene" aria-hidden>
      <Boundary onFail={() => setFailed(true)}>
        <Canvas dpr={dpr} camera={{ fov: 40, near: 1, far: 1200, position: [0, 40, 90] }} gl={{ antialias: true, powerPreference: "low-power" }}>
          {dpr !== 1 && <WhenSlow onSlow={() => setDpr(1)} />}
          <Environment id={env} radius={radius} />
          <TableModel style={table} radius={radius} seatCount={SEATS} />
          <SetTable radius={radius} />
          <TitleCamera radius={radius} />
        </Canvas>
      </Boundary>
    </div>
  );
}

/** A 3D scene that fails to start just leaves Home's plain background. */
class Boundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("Title backdrop failed:", error);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Circles the table about once every three minutes, from a little above eye level, so the room behind it turns
 * slowly past. Aimed above the table so it sits low in the frame, under the title and the menus.
 */
export function TitleCamera({ radius }: { radius: number }) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(0, 10, 0), []);
  const dist = radius * 2.3 + 34;
  useFrame(({ clock }) => {
    const t = reducedMotion() ? 0 : clock.elapsedTime;
    const az = 0.6 + t * 0.035;
    const polar = 1.12 + Math.sin(t * 0.05) * 0.04;
    camera.position.set(Math.sin(az) * Math.sin(polar) * dist, target.y + Math.cos(polar) * dist, Math.cos(az) * Math.sin(polar) * dist);
    camera.lookAt(target);
  });
  return null;
}

const CARD_GEO = roundedRectGeometry(CARD_W, CARD_H, 0.14);

/** Two libraries, two small battlefields of face-down cards, and a d20 that slowly turns. */
function SetTable({ radius }: { radius: number }) {
  const back = backTexture();
  const cards = useMemo(() => {
    const rand = seeded(12);
    const out: { x: number; z: number; rot: number; tapped: boolean }[] = [];
    for (const side of [1, -1])
      for (let i = 0; i < 5; i++) {
        const x = -6 + i * 3 + (rand() - 0.5) * 0.4;
        const z = side * (radius * 0.28 + (i % 2) * 0.6);
        out.push({ x: side * x, z, rot: (side > 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.08, tapped: rand() < 0.25 });
      }
    return out;
  }, [radius]);
  const die = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (die.current && !reducedMotion()) die.current.rotation.y = clock.elapsedTime * 0.3;
  });
  return (
    <group>
      {[1, -1].map((side) => (
        <group key={side} position={[side * 11, 0, side * radius * 0.42]} rotation-y={side > 0 ? 0 : Math.PI}>
          <mesh position-y={0.7}>
            <boxGeometry args={[CARD_W * 0.98, 1.4, CARD_H * 0.98]} />
            <meshStandardMaterial color="#1b1530" roughness={0.8} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={1.41} geometry={CARD_GEO}>
            <meshStandardMaterial map={back} roughness={0.55} />
          </mesh>
        </group>
      ))}
      {cards.map((c, i) => (
        <mesh key={i} geometry={CARD_GEO} rotation={[-Math.PI / 2, 0, c.rot - (c.tapped ? Math.PI / 2 : 0)]} position={[c.x, 0.03 + i * 0.002, c.z]}>
          <meshStandardMaterial map={back} roughness={0.55} />
        </mesh>
      ))}
      <mesh ref={die} position={[3, 1.1, -2]} rotation={[0.4, 0, 0.3]}>
        <icosahedronGeometry args={[1.2, 0]} />
        <meshStandardMaterial color="#b0352a" roughness={0.35} metalness={0.1} flatShading />
      </mesh>
    </group>
  );
}
