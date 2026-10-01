// Textures for the 3D booster pack, all drawn on canvases (no image files): the printed foil, a
// roughness/metalness map (stamped foil is glossy, printed areas less so) and a normal map with the
// crimp ridges, creases and embossed lettering. Each UI theme has its own pack.

import * as THREE from "three";
import { CRIMP_H, HALF_H, PACK_H, PACK_W, TEAR_Y } from "./packShape";

export const TEX_W = 1024;
export const TEX_H = Math.round((TEX_W * PACK_H) / PACK_W);
const CRIMP_PX = Math.round((CRIMP_H / PACK_H) * TEX_H);
const TEAR_PX = Math.round(((HALF_H - TEAR_Y) / PACK_H) * TEX_H);

export interface Palette {
  /** Foil gradient, top to bottom. */
  foil: [string, string, string];
  /** Stamped lettering and ornament. */
  ink: string;
  inkDim: string;
  /** Soft light behind the emblem, and the glow that leaks out of a torn pack. */
  glow: string;
  /** A second colour for bands and highlights. */
  accent: string;
  /** The colour of the light grazing the pack's edges from behind. */
  rim: string;
  pattern: "sunburst" | "lattice" | "diagonal";
  /** Metal look: how shiny the base foil is (0 matte … 1 mirror). */
  shine: number;
}

export const PALETTES: Record<string, Palette> = {
  arcane: { foil: ["#8f73ff", "#4a2ccc", "#170f38"], ink: "#ffe19a", inkDim: "#cfae5e", glow: "#c9b2ff", accent: "#45e0ff", rim: "#8fb8ff", pattern: "sunburst", shine: 0.85 },
  gamenight: { foil: ["#cf4a3d", "#8f2a22", "#3a0e0b"], ink: "#efd6a0", inkDim: "#b8924f", glow: "#ffc48a", accent: "#c9a15a", rim: "#ffb27a", pattern: "lattice", shine: 0.8 },
  signal: { foil: ["#323437", "#17181a", "#08090a"], ink: "#f4f4ef", inkDim: "#9b9c96", glow: "#e3ff6a", accent: "#d4f53c", rim: "#dfe6ff", pattern: "diagonal", shine: 0.6 },
};

export function currentTheme(): string {
  return document.documentElement.dataset.theme ?? "gamenight";
}

export function paletteFor(theme: string): Palette {
  return PALETTES[theme] ?? PALETTES.gamenight;
}

export interface PackLabel {
  brand: string;
  name: string;
  meta: string;
}

export interface PackArt {
  palette: Palette;
  front: THREE.CanvasTexture;
  back: THREE.CanvasTexture;
  /** G = roughness, B = metalness (what three.js reads). */
  frontOrm: THREE.CanvasTexture;
  backOrm: THREE.CanvasTexture;
  frontNormal: THREE.CanvasTexture;
  backNormal: THREE.CanvasTexture;
  dispose(): void;
}

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w = TEX_W, h = TEX_H): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A four-pointed star with concave sides, the pack's sparkle emblem. */
function sparklePath(ctx: Ctx, cx: number, cy: number, r: number, pinch = 0.16) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 - Math.PI / 2;
    const a1 = a0 + Math.PI / 2;
    const tip = { x: cx + Math.cos(a0) * r, y: cy + Math.sin(a0) * r };
    const next = { x: cx + Math.cos(a1) * r, y: cy + Math.sin(a1) * r };
    if (i === 0) ctx.moveTo(tip.x, tip.y);
    const mid = (a0 + a1) / 2;
    ctx.quadraticCurveTo(cx + Math.cos(mid) * r * pinch, cy + Math.sin(mid) * r * pinch, next.x, next.y);
  }
  ctx.closePath();
}

// --- the printed foil ---------------------------------------------------------------------------

function paintFoil(ctx: Ctx, p: Palette, seed: number) {
  const rand = rng(seed);
  const g = ctx.createLinearGradient(0, 0, TEX_W * 0.35, TEX_H);
  g.addColorStop(0, p.foil[0]);
  g.addColorStop(0.45, p.foil[1]);
  g.addColorStop(1, p.foil[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  ctx.save();
  if (p.pattern === "sunburst") {
    ctx.translate(TEX_W / 2, TEX_H * 0.44);
    const n = 56;
    for (let i = 0; i < n; i++) {
      if (i % 2) continue;
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, TEX_H, a0, a1);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fill();
    }
  } else if (p.pattern === "lattice") {
    ctx.strokeStyle = rgba(p.ink, 0.11);
    ctx.lineWidth = 2;
    const step = 64;
    for (let k = -TEX_H; k < TEX_W + TEX_H; k += step) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + TEX_H, TEX_H);
      ctx.moveTo(k + TEX_H, 0);
      ctx.lineTo(k, TEX_H);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    for (let k = -TEX_H; k < TEX_W + TEX_H; k += 14) {
      ctx.beginPath();
      ctx.moveTo(k, TEX_H);
      ctx.lineTo(k + TEX_H, 0);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Signal: a lime band slashed across the pack, like a limited drop.
  if (p.pattern === "diagonal") {
    ctx.save();
    ctx.translate(TEX_W / 2, TEX_H * 0.265);
    ctx.rotate(-0.12);
    ctx.fillStyle = p.accent;
    ctx.fillRect(-TEX_W, -44, TEX_W * 2, 88);
    ctx.restore();
  }

  // Spotlight behind the emblem.
  const glow = ctx.createRadialGradient(TEX_W / 2, TEX_H * 0.44, 10, TEX_W / 2, TEX_H * 0.44, TEX_W * 0.62);
  // Signal's glow is lime, which would turn its graphite foil olive, so it only gets a hint.
  const spot = p.pattern === "diagonal" ? 0.12 : 0.42;
  glow.addColorStop(0, rgba(p.glow, spot));
  glow.addColorStop(0.5, rgba(p.glow, spot / 4));
  glow.addColorStop(1, "rgba(0,0,0,0.0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Specks of glitter.
  for (let i = 0; i < 90; i++) {
    const x = rand() * TEX_W;
    const y = rand() * TEX_H;
    ctx.fillStyle = `rgba(255,255,255,${0.1 + rand() * 0.3})`;
    sparklePath(ctx, x, y, 3 + rand() * 7, 0.2);
    ctx.fill();
  }

  // Vignette toward the edges so the pillow reads even before lighting.
  const v = ctx.createLinearGradient(0, 0, TEX_W, 0);
  v.addColorStop(0, "rgba(0,0,0,0.35)");
  v.addColorStop(0.16, "rgba(0,0,0,0)");
  v.addColorStop(0.84, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // The crimped seals, a touch darker and with a bright lip where the foil was pressed.
  for (const top of [true, false]) {
    const y0 = top ? 0 : TEX_H - CRIMP_PX;
    const band = ctx.createLinearGradient(0, y0, 0, y0 + CRIMP_PX);
    band.addColorStop(0, top ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.1)");
    band.addColorStop(1, top ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.2)");
    ctx.fillStyle = band;
    ctx.fillRect(0, y0, TEX_W, CRIMP_PX);
  }
}

function fitFont(ctx: Ctx, text: string, family: string, weight: string, maxPx: number, maxWidth: number, style = ""): number {
  let size = maxPx;
  for (; size > 14; size -= 2) {
    ctx.font = `${style} ${weight} ${size}px ${family}`.trim();
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

function spaced(ctx: Ctx, px: number) {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** The stamped / printed layer: frame, emblem and lettering, drawn in ink on transparency. */
function paintPrint(ctx: Ctx, p: Palette, label: PackLabel, family: string, front: boolean) {
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // "Tear here" running along the strip between the crimp and the tear line.
  const stripMid = (CRIMP_PX + TEAR_PX) / 2;
  ctx.fillStyle = rgba(p.inkDim, 0.75);
  ctx.font = `700 ${Math.round((TEAR_PX - CRIMP_PX) * 0.5)}px ${family}`;
  spaced(ctx, 6);
  ctx.fillText("TEAR HERE ▸ ▸ ▸ ▸ TEAR HERE", TEX_W / 2, stripMid + 2);
  spaced(ctx, 0);

  if (!front) {
    // The back: a few lines of small print either side of the fin seal.
    ctx.fillStyle = rgba(p.inkDim, 0.8);
    ctx.font = `600 34px ${family}`;
    spaced(ctx, 4);
    ctx.fillText(label.brand.toUpperCase(), TEX_W / 2, TEX_H * 0.3);
    ctx.font = `500 26px ${family}`;
    ctx.fillText("FOIL BOOSTER", TEX_W / 2, TEX_H * 0.3 + 52);
    spaced(ctx, 0);
    ctx.fillStyle = p.ink;
    sparklePath(ctx, TEX_W / 2, TEX_H * 0.52, 120);
    ctx.fill();
    return;
  }

  const top = TEAR_PX + 48;
  const bottom = TEX_H - CRIMP_PX - 52;
  // Frame: a heavy rule, a thin one inside, and notched corners.
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(56, top, TEX_W - 112, bottom - top, 18);
  ctx.stroke();
  ctx.strokeStyle = rgba(p.ink, 0.55);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(76, top + 20, TEX_W - 152, bottom - top - 40, 10);
  ctx.stroke();

  const cx = TEX_W / 2;
  const cy = TEX_H * 0.42;
  // Emblem: a ring with tick marks around a big sparkle.
  ctx.strokeStyle = rgba(p.ink, 0.85);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 262, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 236, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = 266;
    const r1 = i % 6 === 0 ? 300 : 282;
    ctx.lineWidth = i % 6 === 0 ? 5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.fillStyle = p.ink;
  sparklePath(ctx, cx, cy, 214, 0.13);
  ctx.fill();
  // A smaller counter-rotated star gives it depth.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = rgba(p.ink, 0.6);
  sparklePath(ctx, 0, 0, 132, 0.14);
  ctx.fill();
  ctx.restore();

  // Lettering.
  ctx.fillStyle = p.ink;
  const brandY = TEX_H * 0.42 + 400;
  const brandPx = fitFont(ctx, label.brand.toUpperCase(), family, "800", 104, TEX_W - 240);
  ctx.font = `800 ${brandPx}px ${family}`;
  spaced(ctx, Math.round(brandPx * 0.06));
  ctx.fillText(label.brand.toUpperCase(), cx, brandY);
  spaced(ctx, 0);

  const namePx = fitFont(ctx, label.name, family, "700", 64, TEX_W - 260);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${namePx}px ${family}`;
  ctx.fillText(label.name, cx, brandY + brandPx * 0.78);

  ctx.fillStyle = p.inkDim;
  ctx.font = `700 34px ${family}`;
  spaced(ctx, 7);
  ctx.fillText(label.meta.toUpperCase(), cx, brandY + brandPx * 0.78 + namePx * 0.95 + 14);
  spaced(ctx, 0);

  // A barcode, because every pack has one.
  const rand = rng(7);
  let x = cx - 150;
  ctx.fillStyle = rgba(p.inkDim, 0.9);
  while (x < cx + 150) {
    const w = 3 + Math.floor(rand() * 3) * 3;
    ctx.fillRect(x, bottom - 92, w, 52);
    x += w + 3 + Math.floor(rand() * 3) * 3;
  }
}

// --- roughness / metalness and the normal map --------------------------------------------------

/** G = roughness, B = metalness. Stamped ink is mirror-bright gold foil; the base foil is satin. */
function buildOrm(print: Ctx, p: Palette): HTMLCanvasElement {
  const [c, ctx] = makeCanvas();
  const src = print.getImageData(0, 0, TEX_W, TEX_H).data;
  const out = ctx.createImageData(TEX_W, TEX_H);
  const baseRough = 0.44 - 0.3 * p.shine;
  for (let i = 0; i < TEX_W * TEX_H; i++) {
    const a = src[i * 4 + 3] / 255;
    const rough = baseRough * (1 - a) + 0.14 * a;
    const metal = 0.78 + 0.22 * p.shine;
    out.data[i * 4] = 255;
    out.data[i * 4 + 1] = Math.round(rough * 255);
    out.data[i * 4 + 2] = Math.round(Math.min(1, metal) * 255);
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Heights in 0…1: crimp ridges, soft creases, a fin seal down the back and embossed ink. */
function buildHeight(print: Ctx, front: boolean, seed: number): Float32Array {
  const [, h] = makeCanvas();
  const rand = rng(seed);
  h.fillStyle = "#808080";
  h.fillRect(0, 0, TEX_W, TEX_H);

  // Creases: pairs of thin light/dark lines, as if the foil had been squeezed.
  h.lineCap = "round";
  try {
    h.filter = "blur(2.5px)";
  } catch {
    /* no canvas filters: the creases are just sharper */
  }
  for (let i = 0; i < 26; i++) {
    const x0 = rand() * TEX_W;
    const y0 = CRIMP_PX + rand() * (TEX_H - CRIMP_PX * 2);
    const ang = (rand() - 0.5) * 1.4 + (rand() < 0.5 ? 0 : Math.PI / 2);
    const len = 120 + rand() * 360;
    const bend = (rand() - 0.5) * 90;
    for (const [dx, col] of [[0, "rgba(255,255,255,0.22)"], [7, "rgba(0,0,0,0.26)"]] as const) {
      h.strokeStyle = col;
      h.lineWidth = 3 + rand() * 3;
      h.beginPath();
      h.moveTo(x0 + dx, y0);
      h.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.5 + bend + dx, y0 + Math.sin(ang) * len * 0.5, x0 + Math.cos(ang) * len + dx, y0 + Math.sin(ang) * len);
      h.stroke();
    }
  }
  h.filter = "none";

  // Fin seal: the lap seam that runs down the middle of a real pack's back.
  if (!front) {
    const w = 86;
    const x0 = (TEX_W - w) / 2;
    h.fillStyle = "rgba(255,255,255,0.4)";
    h.fillRect(x0, CRIMP_PX, w, TEX_H - CRIMP_PX * 2);
    h.fillStyle = "rgba(0,0,0,0.35)";
    for (let y = CRIMP_PX; y < TEX_H - CRIMP_PX; y += 10) h.fillRect(x0 + 8, y, w - 16, 3);
  }

  // Crimp ridges: fine vertical grooves across both seals, with a pressed-flat lip at the body edge.
  for (const top of [true, false]) {
    const y0 = top ? 0 : TEX_H - CRIMP_PX;
    for (let x = 0; x < TEX_W; x += 12) {
      h.fillStyle = "rgba(255,255,255,0.5)";
      h.fillRect(x, y0, 6, CRIMP_PX);
      h.fillStyle = "rgba(0,0,0,0.45)";
      h.fillRect(x + 6, y0, 6, CRIMP_PX);
    }
    h.fillStyle = "rgba(128,128,128,0.9)";
    h.fillRect(0, top ? CRIMP_PX - 8 : TEX_H - CRIMP_PX, TEX_W, 8);
  }

  // Embossed ink: the printed layer sits slightly proud of the foil.
  h.globalAlpha = 0.22;
  h.filter = "blur(1.5px)";
  h.drawImage(print.canvas, 0, 0);
  h.globalAlpha = 1;
  h.filter = "none";

  const data = h.getImageData(0, 0, TEX_W, TEX_H).data;
  const out = new Float32Array(TEX_W * TEX_H);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4] / 255 + (rand() - 0.5) * 0.012;
  return out;
}

function heightToNormal(height: Float32Array, strength: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas();
  const img = ctx.createImageData(TEX_W, TEX_H);
  const at = (x: number, y: number) => height[Math.min(TEX_H - 1, Math.max(0, y)) * TEX_W + Math.min(TEX_W - 1, Math.max(0, x))];
  for (let y = 0; y < TEX_H; y++) {
    for (let x = 0; x < TEX_W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // Canvas rows run down while v runs up, hence the sign.
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * TEX_W + x) * 4;
      img.data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function texture(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Waits (briefly) for the theme's display font so the lettering isn't drawn in a fallback face. */
async function fontReady(family: string) {
  try {
    await Promise.race([document.fonts.load(`800 48px ${family}`), new Promise((r) => setTimeout(r, 700))]);
  } catch {
    /* draw with whatever is there */
  }
}

export async function buildPackArt(label: PackLabel, theme = currentTheme()): Promise<PackArt> {
  const palette = paletteFor(theme);
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "Georgia, serif";
  await fontReady(family);

  const make = (front: boolean) => {
    const [fc, fctx] = makeCanvas();
    paintFoil(fctx, palette, front ? 11 : 23);
    const [pc, pctx] = makeCanvas();
    paintPrint(pctx, palette, label, family, front);
    fctx.drawImage(pc, 0, 0);
    const orm = buildOrm(pctx, palette);
    const normal = heightToNormal(buildHeight(pctx, front, front ? 5 : 9), 3.4);
    return { map: texture(fc, true), orm: texture(orm, false), normal: texture(normal, false) };
  };

  const f = make(true);
  const b = make(false);
  const all = [f.map, f.orm, f.normal, b.map, b.orm, b.normal];
  return {
    palette,
    front: f.map,
    frontOrm: f.orm,
    frontNormal: f.normal,
    back: b.map,
    backOrm: b.orm,
    backNormal: b.normal,
    dispose: () => all.forEach((t) => t.dispose()),
  };
}
