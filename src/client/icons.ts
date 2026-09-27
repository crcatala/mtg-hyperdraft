// HyperDraft's icon set: plain SVG path data on a 24×24 grid, so the same shapes render as DOM
// <svg> (coloured with CSS `currentColor`, see components/Icon.tsx) and onto canvas textures (3D
// table labels, text-only card faces) via Path2D. Strokes are round-capped line art; a few parts
// are solid fills for weight (eyes, pips, stars).

export interface IconPart {
  d: string;
  /** Solid fill. Parts are stroked unless `fill` is set without `stroke`. */
  fill?: boolean;
  /** Also stroke a filled part, which rounds its corners (the stroke joins are round). */
  stroke?: boolean;
}

const f = (n: number) => +n.toFixed(2);

function circle(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0z`;
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${f(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${f(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

/** Four-pointed star with concave sides (the ✦ sparkle): `rx` to the side tips, `ry` up and down. */
function star4(cx: number, cy: number, rx: number, ry = rx): string {
  const [ax, bx, ay, by] = [0.09 * rx, 0.37 * rx, 0.09 * ry, 0.37 * ry];
  return [
    `M${f(cx)} ${f(cy - ry)}`,
    `C${f(cx + ax)} ${f(cy - by)} ${f(cx + bx)} ${f(cy - ay)} ${f(cx + rx)} ${f(cy)}`,
    `C${f(cx + bx)} ${f(cy + ay)} ${f(cx + ax)} ${f(cy + by)} ${f(cx)} ${f(cy + ry)}`,
    `C${f(cx - ax)} ${f(cy + by)} ${f(cx - bx)} ${f(cy + ay)} ${f(cx - rx)} ${f(cy)}`,
    `C${f(cx - bx)} ${f(cy - ay)} ${f(cx - ax)} ${f(cy - by)} ${f(cx)} ${f(cy - ry)}z`,
  ].join("");
}

/** Cog outline: `teeth` flat-topped teeth between radii `inner` and `outer`. */
function gear(teeth: number, inner: number, outer: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [da, r] of [[-0.3, inner], [-0.18, outer], [0.18, outer], [0.3, inner]] as const) {
      const t = a + da * step * 1.1;
      pts.push(`${f(12 + Math.cos(t) * r)} ${f(12 + Math.sin(t) * r)}`);
    }
  }
  return `M${pts.join("L")}z`;
}

const stroke = (d: string): IconPart => ({ d });
const solid = (d: string): IconPart => ({ d, fill: true });
/** Filled and stroked: a solid shape with softened corners. */
const soft = (d: string): IconPart => ({ d, fill: true, stroke: true });

export const ICONS = {
  // --- table zones & counters ---
  /** Cards in hand: two fanned cards. */
  hand: [stroke("M10.9 4.05L3.3 6.05L7.2 20.55L12 19.25"), stroke("M7.2 18L11.05 3.5L20.7 6.1L16.8 20.6z")],
  /** Library: a face-down card on top of a stack. */
  library: [stroke(roundRect(5, 2, 14, 14, 2)), solid("M12 5.6l3.4 3.4-3.4 3.4-3.4-3.4z"), stroke("M5.5 19.5h13"), stroke("M7 22.5h10")],
  graveyard: [stroke("M6 20.5V10a6 6 0 0 1 12 0v10.5"), stroke("M3.5 20.5h17"), stroke("M12 8v6.5"), stroke("M9.5 10.5h5")],
  /** Exile: an open four-pointed star (the old ✧). */
  exile: [stroke(star4(12, 12, 9.5))],
  skull: [
    stroke("M12 3C7.3 3 4 6.2 4 10.5c0 2.6 1.2 4.3 3 5.4V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.1c1.8-1.1 3-2.8 3-5.4C20 6.2 16.7 3 12 3z"),
    solid(circle(9, 11, 1.7)),
    solid(circle(15, 11, 1.7)),
    soft("M12 13.6l-0.9 1.7h1.8z"),
    stroke("M10.5 17.5v2.5"),
    stroke("M13.5 17.5v2.5"),
  ],
  /** d20, face on. */
  dice: [
    stroke("M12 2l8.66 5v10L12 22l-8.66-5V7z"),
    stroke("M12 7.5l4.5 7.75h-9z"),
    stroke("M12 2v5.5"),
    stroke("M3.34 17l4.16-1.75"),
    stroke("M20.66 17l-4.16-1.75"),
  ],
  pin: [stroke("M12 21.5s7-6.2 7-11.5a7 7 0 0 0-14 0c0 5.3 7 11.5 7 11.5z"), stroke(circle(12, 10, 2.5))],
  /** End turn: skip forward. */
  skip: [soft("M5 5.5v13l9-6.5z"), stroke("M18.5 5.5v13")],

  // --- players ---
  bot: [
    stroke(roundRect(4, 8, 16, 12, 3)),
    stroke("M12 8V5"),
    solid(circle(12, 3.6, 1.5)),
    solid(circle(9, 13.2, 1.5)),
    solid(circle(15, 13.2, 1.5)),
    stroke("M10 16.8h4"),
    stroke("M1.8 12.5v3"),
    stroke("M22.2 12.5v3"),
  ],
  crown: [soft("M4 17.5L3 7.5l5 3.8L12 4.5l4 6.8 5-3.8-1 10z"), stroke("M4.5 21h15")],

  // --- general UI ---
  volume: [stroke("M3.5 9.5H7l4.5-4v13l-4.5-4H3.5z"), stroke("M15 9a4.2 4.2 0 0 1 0 6"), stroke("M18 6.3a8 8 0 0 1 0 11.4")],
  "volume-off": [stroke("M3.5 9.5H7l4.5-4v13l-4.5-4H3.5z"), stroke("M15.5 9.5l5 5"), stroke("M20.5 9.5l-5 5")],
  pencil: [stroke("M4 20l1.1-4.5L15.6 5a2.1 2.1 0 0 1 3 0l.4.4a2.1 2.1 0 0 1 0 3L8.5 18.9z"), stroke("M13.6 7l3.4 3.4")],
  copy: [stroke("M8 7.8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-2.3"), stroke(roundRect(4, 8, 12, 12, 1.5))],
  sparkle: [solid(star4(12, 12, 10))],
  /** Magic: one big sparkle and a small one (auto-build). */
  sparkles: [solid(star4(10, 14, 8)), solid(star4(18.5, 5.5, 3.6))],
  bolt: [soft("M13.5 2.5L5 13.5h6.2l-1.2 8L18.5 10.5h-6.2z")],
  play: [soft("M7 4.8v14.4L19 12z")],
  timer: [stroke(circle(12, 13.5, 7.5)), stroke("M12 13.5V9.8"), stroke("M9.5 2.5h5"), stroke("M12 2.5V6"), stroke("M18.2 6.8l1.5-1.5")],
  /** Turn a card over: counter-clockwise arrow (the old ⟲). */
  flip: [stroke("M4.5 12A7.5 7.5 0 1 0 12 4.5"), stroke("M14.8 1.7L12 4.5l2.8 2.8")],
  gear: [stroke(gear(8, 7.3, 10)), stroke(circle(12, 12, 3))],
  /** Disconnected: signal arcs, struck through. */
  offline: [stroke("M5 10.2a10 10 0 0 1 14 0"), stroke("M8.2 13.6a5.5 5.5 0 0 1 7.6 0"), solid(circle(12, 17.5, 1.4)), stroke("M4 4l16 16")],
  /** View all: a 2×2 grid of cards. */
  grid: [stroke(roundRect(4, 4, 7, 7, 1.5)), stroke(roundRect(13, 4, 7, 7, 1.5)), stroke(roundRect(4, 13, 7, 7, 1.5)), stroke(roundRect(13, 13, 7, 7, 1.5))],
  search: [stroke(circle(10.5, 10.5, 6.5)), stroke("M15.5 15.5L20 20")],
  "zoom-in": [stroke(circle(10.5, 10.5, 6.5)), stroke("M15.5 15.5L20 20"), stroke("M10.5 8v5"), stroke("M8 10.5h5")],
  check: [stroke("M4.5 12.5l5 5 10-11")],
  x: [stroke("M6 6l12 12"), stroke("M18 6L6 18")],
  plus: [stroke("M12 5v14"), stroke("M5 12h14")],
  minus: [stroke("M5 12h14")],
  "chevron-down": [stroke("M6 9l6 6 6-6")],
  "chevron-right": [stroke("M9 6l6 6-6 6")],
  "chevron-left": [stroke("M15 6l-6 6 6 6")],
  "arrow-down": [stroke("M12 4.5v15"), stroke("M6 13.5l6 6 6-6")],
  "arrow-left": [stroke("M19.5 12h-15"), stroke("M10.5 6l-6 6 6 6")],
  "arrow-right": [stroke("M4.5 12h15"), stroke("M13.5 6l6 6-6 6")],

  // --- card types (art on text-only cards) ---
  /** Crossed swords: long blades crossing high, guards and hilts low. */
  creature: [
    solid("M3 3l2.8 1.2 10 10-1.6 1.6-10-10z"),
    stroke("M12.5 18.5l6-6"),
    stroke("M15.5 15.5l4.5 4.5"),
    solid("M21 3l-1.2 2.8-10 10-1.6-1.6 10-10z"),
    stroke("M11.5 18.5l-6-6"),
    stroke("M8.5 15.5L4 20"),
  ],
  sorcery: [
    stroke(circle(12, 12, 3.8)),
    stroke("M12 2v3"),
    stroke("M12 19v3"),
    stroke("M2 12h3"),
    stroke("M19 12h3"),
    stroke("M4.9 4.9l2.1 2.1"),
    stroke("M17 17l2.1 2.1"),
    stroke("M4.9 19.1L7 17"),
    stroke("M17 7l2.1-2.1"),
  ],
  enchantment: [stroke(circle(12, 12, 9)), solid(star4(12, 12, 5))],
  land: [stroke("M2.5 19.5L9 7.5l4.2 7 2.3-3.3 6 8.3z")],
  /** A tall spark (the old ✧, stretched so it differs from exile). */
  planeswalker: [stroke(star4(12, 12, 6, 10.5))],
  diamond: [soft("M12 3.5l7.5 8.5-7.5 8.5-7.5-8.5z")],
} satisfies Record<string, IconPart[]>;

export type IconName = keyof typeof ICONS;

/** The art icon for a text-only card face, by type line. */
export function cardTypeIcon(typeLine: string): IconName {
  if (/Planeswalker/.test(typeLine)) return "planeswalker";
  if (/Creature/.test(typeLine)) return "creature";
  if (/Instant/.test(typeLine)) return "bolt";
  if (/Sorcery/.test(typeLine)) return "sorcery";
  if (/Enchantment/.test(typeLine)) return "enchantment";
  if (/Artifact/.test(typeLine)) return "gear";
  if (/Land/.test(typeLine)) return "land";
  return "diamond";
}

/** Default stroke width, in grid units (the DOM uses the same value via CSS). */
export const ICON_STROKE = 2;

/** Draws an icon onto a canvas, `size` px square with its top-left corner at (x, y). */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string, strokeWidth = ICON_STROKE) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const part of ICONS[name] as IconPart[]) {
    const p = new Path2D(part.d);
    if (part.fill) ctx.fill(p);
    if (!part.fill || part.stroke) ctx.stroke(p);
  }
  ctx.restore();
}
