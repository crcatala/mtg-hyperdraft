// Card textures for the 3D table. A card starts with a canvas-drawn text face (instant, offline),
// then swaps to the Scryfall image once it loads. Textures are cached and shared between meshes.

import * as THREE from "three";
import { useEffect, useState } from "react";
import type { CardData, TokenDef } from "../../shared/types";
import { faceOf, frameColors, imageUrl } from "../cardStyle";
import { useStore } from "../store";
import { whenLoaded } from "../imageCache";
import { MAT_D, MAT_W, PILE_LOCAL, BATTLEFIELD_LOCAL, CARD_W, CARD_H } from "../../shared/tableLayout";

const TW = 488;
const TH = 680;

interface Entry {
  texture: THREE.Texture;
  image: boolean;
  listeners: Set<() => void>;
}

const cache = new Map<string, Entry>();

function finish(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function canvas(w = TW, h = TH): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

const PIP_COLORS: Record<string, string> = { W: "#f8f3d6", U: "#a9d3f2", B: "#b9aeb0", R: "#f2a38b", G: "#9fd3a7" };

function drawCost(ctx: CanvasRenderingContext2D, cost: string, right: number, cy: number) {
  const syms = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).reverse();
  let x = right;
  for (const s of syms) {
    const r = 17;
    x -= r;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    const first = s.split("/")[0];
    ctx.fillStyle = PIP_COLORS[first] ?? "#cfc9c4";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.font = "bold 20px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.length > 2 ? s.replace("/", "") : s, x, cy + 1);
    x -= r + 3;
  }
  return x;
}

interface FaceLike {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors: CardData["colors"];
}

function drawTextFace(f: FaceLike, footer: string): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const col = frameColors({ colors: f.colors, typeLine: f.typeLine });
  // frame
  roundRect(ctx, 0, 0, TW, TH, 24);
  const g = ctx.createLinearGradient(0, 0, TW, TH);
  g.addColorStop(0, col.accent);
  g.addColorStop(0.45, col.frame);
  g.addColorStop(1, "#111");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = "#0c0c0c";
  roundRect(ctx, 6, 6, TW - 12, TH - 12, 20);
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.stroke();
  // name bar
  const bar = (y: number, h: number) => {
    roundRect(ctx, 22, y, TW - 44, h, 14);
    ctx.fillStyle = col.inner;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 3;
    ctx.stroke();
  };
  bar(24, 50);
  const costLeft = drawCost(ctx, f.manaCost, TW - 32, 49);
  ctx.fillStyle = col.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "700 27px Cinzel, Georgia, serif";
  ctx.fillText(f.name, 36, 50, costLeft - 44);
  // art box
  const artY = 82;
  const artH = 270;
  const ag = ctx.createRadialGradient(TW * 0.3, artY + 60, 10, TW * 0.5, artY + artH / 2, 320);
  ag.addColorStop(0, "#fff");
  ag.addColorStop(0.25, col.accent);
  ag.addColorStop(1, col.frame);
  ctx.fillStyle = ag;
  ctx.fillRect(34, artY, TW - 68, artH);
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 4;
  ctx.strokeRect(34, artY, TW - 68, artH);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "120px serif";
  ctx.textAlign = "center";
  ctx.fillText(glyph(f.typeLine), TW / 2, artY + artH / 2 + 8);
  // type bar
  bar(artY + artH + 8, 44);
  ctx.fillStyle = col.text;
  ctx.textAlign = "left";
  ctx.font = "700 21px Cinzel, Georgia, serif";
  ctx.fillText(f.typeLine, 36, artY + artH + 31, TW - 80);
  // text box
  const boxY = artY + artH + 60;
  const boxH = TH - boxY - 40;
  roundRect(ctx, 34, boxY, TW - 68, boxH, 8);
  ctx.fillStyle = col.inner;
  ctx.fill();
  ctx.fillStyle = col.text;
  let size = 24;
  let lines: string[] = [];
  const text = f.oracleText.replace(/\{([^}]+)\}/g, "($1)");
  do {
    ctx.font = `${size}px "Crimson Pro", Georgia, serif`;
    lines = wrap(ctx, text, TW - 100);
    size -= 1;
  } while (lines.length * size * 1.18 > boxH - 50 && size > 12);
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, 48, boxY + 12 + i * (size + 1) * 1.18));
  // P/T
  const pt = f.power !== undefined ? `${f.power}/${f.toughness}` : f.loyalty;
  if (pt) {
    roundRect(ctx, TW - 130, TH - 78, 100, 46, 12);
    ctx.fillStyle = col.inner;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.stroke();
    ctx.fillStyle = col.text;
    ctx.font = "800 28px Cinzel, Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pt, TW - 80, TH - 54);
  }
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "600 14px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(footer, 30, TH - 18);
  return c;
}

function glyph(typeLine: string) {
  if (/Creature/.test(typeLine)) return "⚔";
  if (/Instant/.test(typeLine)) return "ϟ";
  if (/Sorcery/.test(typeLine)) return "✺";
  if (/Enchantment/.test(typeLine)) return "❂";
  if (/Artifact/.test(typeLine)) return "⚙";
  if (/Land/.test(typeLine)) return "⛰";
  if (/Planeswalker/.test(typeLine)) return "✧";
  return "◆";
}

function notify(e: Entry) {
  e.listeners.forEach((l) => l());
}

function entryFor(key: string, makeText: () => HTMLCanvasElement, url?: string): Entry {
  let e = cache.get(key);
  if (e) return e;
  e = { texture: finish(new THREE.CanvasTexture(makeText())), image: false, listeners: new Set() };
  cache.set(key, e);
  if (url) {
    // Same shared image the DOM cards use — no second download for the 3D table.
    const entry = e;
    whenLoaded(url, (img) => {
      entry.texture.dispose();
      entry.texture = finish(new THREE.Texture(img));
      entry.image = true;
      notify(entry);
    });
  }
  return e;
}

export function cardTextureEntry(card: CardData, face: number, forceText: boolean): Entry {
  const url = forceText ? undefined : imageUrl(card, face, "normal");
  return entryFor(`${card.id}:${face}:${forceText ? "t" : "i"}`, () => drawTextFace(faceOf(card, face), `${card.set.toUpperCase()} · ${card.rarity}`), url);
}

export function tokenTextureEntry(token: TokenDef): Entry {
  const key = `token:${token.name}:${token.power}/${token.toughness}:${token.colors.join("")}:${token.text ?? ""}`;
  return entryFor(key, () =>
    drawTextFace(
      { name: token.name, manaCost: "", typeLine: "Token", oracleText: token.text ?? "", power: token.power, toughness: token.toughness, colors: token.colors },
      "TOKEN",
    ),
  );
}

/** React hook: the best available texture for a card face, re-rendering when the image arrives. */
export function useCardTexture(card: CardData | undefined, face: number, token?: TokenDef): THREE.Texture {
  const forceText = useStore((s) => s.debug.forceText);
  const entry = card ? cardTextureEntry(card, face, forceText) : token ? tokenTextureEntry(token) : backEntry();
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    entry.listeners.add(l);
    return () => void entry.listeners.delete(l);
  }, [entry]);
  return entry.texture;
}

// --- static textures ------------------------------------------------------------------------

let back: Entry | null = null;
function backEntry(): Entry {
  if (back) return back;
  const [c, ctx] = canvas();
  roundRect(ctx, 0, 0, TW, TH, 24);
  const g = ctx.createLinearGradient(0, 0, TW, TH);
  g.addColorStop(0, "#2a1f52");
  g.addColorStop(0.6, "#120d24");
  g.addColorStop(1, "#0b0716");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.translate(TW / 2, TH * 0.45);
  for (let i = 0; i < 30; i++) {
    ctx.rotate((Math.PI * 2) / 30);
    ctx.fillStyle = i % 2 ? "rgba(244,197,91,0.08)" : "rgba(143,107,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-30, -400);
    ctx.lineTo(30, -400);
    ctx.fill();
  }
  ctx.restore();
  const rg = ctx.createRadialGradient(TW / 2, TH * 0.45, 10, TW / 2, TH * 0.45, 220);
  rg.addColorStop(0, "rgba(143,107,255,0.7)");
  rg.addColorStop(1, "rgba(143,107,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, TW, TH);
  ctx.strokeStyle = "rgba(244,197,91,0.75)";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(TW / 2, TH * 0.45, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffdf8e";
  ctx.shadowColor = "rgba(244,197,91,0.8)";
  ctx.shadowBlur = 20;
  ctx.textAlign = "center";
  ctx.font = "800 50px Cinzel, Georgia, serif";
  ctx.fillText("HYPER", TW / 2, TH * 0.45 - 4);
  ctx.fillText("DRAFT", TW / 2, TH * 0.45 + 50);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#0d0a18";
  ctx.lineWidth = 26;
  roundRect(ctx, 0, 0, TW, TH, 24);
  ctx.stroke();
  back = { texture: finish(new THREE.CanvasTexture(c)), image: false, listeners: new Set() };
  return back;
}

export function backTexture(): THREE.Texture {
  return backEntry().texture;
}

export function feltTexture(): THREE.Texture {
  const [c, ctx] = canvas(1024, 1024);
  const g = ctx.createRadialGradient(512, 512, 50, 512, 512, 720);
  g.addColorStop(0, "#23324a");
  g.addColorStop(1, "#0f1522");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  const img = ctx.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = finish(new THREE.CanvasTexture(c));
  return tex;
}

const PX = 40; // canvas pixels per world unit for mats

export function matTexture(name: string, hue: number, isMe: boolean): THREE.Texture {
  const W = MAT_W * PX;
  const H = MAT_D * PX;
  const [c, ctx] = canvas(W, H);
  const toPx = (x: number, y: number) => [(x + MAT_W / 2) * PX, (y + MAT_D / 2) * PX] as const;
  ctx.clearRect(0, 0, W, H);
  roundRect(ctx, 4, 4, W - 8, H - 8, 30);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsla(${hue}, 45%, 22%, 0.55)`);
  g.addColorStop(1, `hsla(${hue}, 55%, 16%, 0.85)`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = isMe ? 6 : 4;
  ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${isMe ? 0.85 : 0.45})`;
  ctx.stroke();

  // lands row guide
  const [lx0, ly0] = toPx(BATTLEFIELD_LOCAL.minX, 2.2);
  const [lx1] = toPx(BATTLEFIELD_LOCAL.maxX, 0);
  ctx.setLineDash([14, 12]);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(lx0, ly0);
  ctx.lineTo(lx1, ly0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.font = "700 26px Cinzel, Georgia, serif";
  ctx.textAlign = "left";
  ctx.fillText("LANDS", lx0 + 8, ly0 + 34);

  // zone slots
  const labels: Record<string, string> = { library: "LIBRARY", graveyard: "GRAVEYARD", exile: "EXILE", sideboard: "SIDEBOARD" };
  for (const [zone, pos] of Object.entries(PILE_LOCAL)) {
    const [cx, cy] = toPx(pos.x, pos.y);
    const w = CARD_W * PX * 1.06;
    const h = CARD_H * PX * 1.04;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 12);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = `hsla(${hue}, 70%, 75%, 0.5)`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `hsla(${hue}, 70%, 85%, 0.55)`;
    ctx.font = "700 17px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(labels[zone], cx, cy + 5);
  }

  // name plate along the near edge
  ctx.fillStyle = `hsla(${hue}, 80%, 80%, 0.8)`;
  ctx.font = "800 34px Cinzel, Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText(name.toUpperCase(), W / 2, H - 22);
  return finish(new THREE.CanvasTexture(c));
}

/** Rounded rectangle geometry with 0..1 UVs, lying in the XY plane. */
export function roundedRectGeometry(w: number, h: number, r: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ShapeGeometry(s, 6);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / w + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / h + 0.5;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

// --- text labels (pile counts, counter badges) ------------------------------------------------

export type LabelVariant = "count" | "counter" | "muted" | "token";

const LABEL_STYLES: Record<LabelVariant, { bg: string; border: string; fg: string }> = {
  count: { bg: "rgba(10,8,18,0.92)", border: "rgba(255,255,255,0.35)", fg: "#ece8f6" },
  counter: { bg: "rgba(20,58,40,0.95)", border: "#4be29a", fg: "#c4ffe0" },
  muted: { bg: "rgba(10,8,18,0.9)", border: "rgba(255,255,255,0.25)", fg: "#9e97b8" },
  token: { bg: "rgba(30,20,60,0.92)", border: "#b79bff", fg: "#d9ccff" },
};

const labelCache = new Map<string, { texture: THREE.Texture; aspect: number }>();

/** A pill-shaped text label as a texture; `aspect` is width / height. */
export function labelTexture(text: string, variant: LabelVariant = "count"): { texture: THREE.Texture; aspect: number } {
  return pillTexture(`${variant}:${text}`, text, LABEL_STYLES[variant]);
}

/** Name tag floating over a ping, in the pinging player's colour. */
export function pingTagTexture(name: string, hue: number): { texture: THREE.Texture; aspect: number } {
  return pillTexture(`ping:${hue}:${name}`, name, { bg: `hsla(${hue}, 45%, 14%, 0.94)`, border: `hsl(${hue}, 85%, 66%)`, fg: `hsl(${hue}, 90%, 88%)` });
}

function pillTexture(key: string, text: string, st: { bg: string; border: string; fg: string }): { texture: THREE.Texture; aspect: number } {
  const hit = labelCache.get(key);
  if (hit) return hit;
  const h = 64;
  const [probe, pctx] = canvas(8, 8);
  void probe;
  pctx.font = "800 38px Inter, sans-serif";
  const w = Math.max(h, Math.ceil(pctx.measureText(text).width) + 40);
  const [c, ctx] = canvas(w, h);
  roundRect(ctx, 3, 3, w - 6, h - 6, (h - 6) / 2);
  ctx.fillStyle = st.bg;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = st.border;
  ctx.stroke();
  ctx.fillStyle = st.fg;
  ctx.font = "800 38px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 2);
  const entry = { texture: finish(new THREE.CanvasTexture(c)), aspect: w / h };
  labelCache.set(key, entry);
  return entry;
}

// --- drag shadows -----------------------------------------------------------------------------

/** Extra world units around the card covered by a soft shadow plane (the blur needs room). */
export const SHADOW_PAD = 1.6;
const shadowCache: Partial<Record<"soft" | "landing", THREE.Texture>> = {};

/**
 * A blurred card-shaped shadow for a plane of (CARD_W + SHADOW_PAD) × (CARD_H + SHADOW_PAD).
 * The "landing" variant adds a faint card outline marking exactly where a dragged card will land.
 */
export function shadowTexture(kind: "soft" | "landing"): THREE.Texture {
  const hit = shadowCache[kind];
  if (hit) return hit;
  const px = 64;
  const W = Math.round((CARD_W + SHADOW_PAD) * px);
  const H = Math.round((CARD_H + SHADOW_PAD) * px);
  const [c, ctx] = canvas(W, H);
  const pad = (SHADOW_PAD / 2) * px;
  const r = 0.14 * px;
  // Draw the card far off-canvas and keep only its blurred shadow (works in every browser,
  // unlike ctx.filter).
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 0.34 * px;
  ctx.shadowOffsetX = 10_000;
  roundRect(ctx, pad - 10_000, pad, W - pad * 2, H - pad * 2, r);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
  if (kind === "landing") {
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, r);
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.stroke();
  }
  const tex = finish(new THREE.CanvasTexture(c));
  shadowCache[kind] = tex;
  return tex;
}

let glow: THREE.Texture | null = null;

/** Soft white radial glow (tinted by the material colour) for ping spots. */
export function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glow = finish(new THREE.CanvasTexture(c));
  return glow;
}
