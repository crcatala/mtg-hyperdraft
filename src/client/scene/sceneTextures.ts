// Canvas-drawn textures for the tables and environments around the 3D table (wood, felt, stone, runes,
// rugs, grass, sky...). Drawn once on first use from a fixed seed, so every player sees the same grain,
// and cached for the life of the page: switching table or environment back and forth draws nothing new.

import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  let tex = cache.get(key) as T | undefined;
  if (!tex) {
    tex = make();
    cache.set(key, tex);
  }
  return tex;
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, opts: { repeat?: [number, number]; color?: boolean } = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  if (opts.color !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...opts.repeat);
  }
  tex.needsUpdate = true;
  return tex;
}

/** Small seeded generator (mulberry32): the same texture on every machine. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds fine grain to whatever is drawn (felt fibres, stone speckle). */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, rand: () => number) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// --- wood -------------------------------------------------------------------------------------

export type WoodKind = "walnut" | "oak" | "floor";

const WOOD: Record<WoodKind, { base: [number, number, number]; spread: number; planks: number; seam: string }> = {
  walnut: { base: [92, 56, 34], spread: 18, planks: 6, seam: "rgba(20,10,4,0.55)" },
  oak: { base: [128, 84, 46], spread: 20, planks: 7, seam: "rgba(36,18,6,0.6)" },
  floor: { base: [96, 64, 40], spread: 26, planks: 8, seam: "rgba(18,9,3,0.8)" },
};

/** Planks running along u, with grain, seams, staggered butt joints and the odd knot. Tiles both ways. */
export function woodTexture(kind: WoodKind, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const key = `wood:${kind}`;
  const base = cached(key, () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    const rand = seeded(kind.length * 977 + 13);
    const w = WOOD[kind];
    const ph = S / w.planks;
    for (let p = 0; p < w.planks; p++) {
      const y0 = p * ph;
      // Each plank is cut into 1-2 boards, joints staggered from the plank beside it.
      const joints = [0, S * (0.3 + rand() * 0.5)];
      for (let j = 0; j < joints.length; j++) {
        const x0 = joints[j];
        const x1 = j + 1 < joints.length ? joints[j + 1] : S;
        const shade = (rand() - 0.5) * w.spread;
        const [r, g, b] = w.base.map((v) => v + shade);
        ctx.fillStyle = rgb(r, g, b);
        ctx.fillRect(x0, y0, x1 - x0, ph);
        // Grain: long wavy lines, darker and lighter.
        const lines = 26;
        for (let l = 0; l < lines; l++) {
          const yy = y0 + rand() * ph;
          const amp = 1 + rand() * 4;
          const freq = 0.004 + rand() * 0.01;
          const phase = rand() * 10;
          ctx.strokeStyle = rand() < 0.6 ? rgb(r * 0.7, g * 0.68, b * 0.66, 0.35 + rand() * 0.3) : rgb(r * 1.18, g * 1.15, b * 1.1, 0.2);
          ctx.lineWidth = 0.6 + rand() * 1.6;
          ctx.beginPath();
          for (let x = x0; x <= x1; x += 8) {
            const yv = yy + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.3;
            if (x === x0) ctx.moveTo(x, yv);
            else ctx.lineTo(x, yv);
          }
          ctx.stroke();
        }
        // A knot now and then.
        if (rand() < 0.35) {
          const kx = x0 + 40 + rand() * Math.max(1, x1 - x0 - 80);
          const ky = y0 + ph * (0.3 + rand() * 0.4);
          for (let k = 6; k > 0; k--) {
            ctx.strokeStyle = rgb(r * 0.55, g * 0.5, b * 0.45, 0.25);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(kx, ky, k * 4.5, k * 1.8, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = rgb(r * 0.45, g * 0.4, b * 0.35, 0.8);
          ctx.beginPath();
          ctx.ellipse(kx, ky, 4, 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        if (x0 > 0) {
          ctx.fillStyle = w.seam;
          ctx.fillRect(x0 - 1.5, y0, 3, ph);
        }
      }
      ctx.fillStyle = w.seam;
      ctx.fillRect(0, y0, S, 3);
      // A soft bevel highlight under each seam.
      ctx.fillStyle = "rgba(255,230,190,0.06)";
      ctx.fillRect(0, y0 + 3, S, 3);
    }
    speckle(ctx, S, S, 10, rand);
    return finish(c, { repeat: [1, 1] });
  });
  if (repeat[0] === 1 && repeat[1] === 1) return base;
  return cached(`${key}:${repeat.join("x")}`, () => {
    const t = base.clone();
    t.repeat.set(...repeat);
    t.needsUpdate = true;
    return t;
  });
}

/** A repeat of a cached texture (shares the canvas; only the tiling differs). */
export function tiled<T extends THREE.Texture>(tex: T, key: string, repeat: [number, number]): T {
  return cached(`${key}:${repeat.join("x")}`, () => {
    const t = tex.clone() as T;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.needsUpdate = true;
    return t;
  });
}

// --- cloth, leather, stone ------------------------------------------------------------------

/** Baize: a soft pool of light in the middle, fibres everywhere. Mapped onto the round play surface. */
export function feltTexture(inner: string, outer: string): THREE.CanvasTexture {
  return cached(`felt:${inner}:${outer}`, () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S * 0.72);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const rand = seeded(7);
    // Faint brushed streaks, then fibres.
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 900; i++) {
      ctx.strokeStyle = rand() < 0.5 ? "#000" : "#fff";
      ctx.lineWidth = 1;
      const x = rand() * S;
      const y = rand() * S;
      const a = rand() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    speckle(ctx, S, S, 16, rand);
    return finish(c);
  });
}

/** Tooled leather for the oak table's inlay: oxblood with a gilt border near the edge of the disc. */
export function leatherTexture(): THREE.CanvasTexture {
  return cached("leather", () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 60, S / 2, S / 2, S / 2);
    g.addColorStop(0, "#6e2a26");
    g.addColorStop(0.85, "#4d1a18");
    g.addColorStop(1, "#3a1311");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const rand = seeded(31);
    // Grain: tiny creases.
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 2600; i++) {
      ctx.strokeStyle = rand() < 0.5 ? "#000" : "#ffd9c0";
      ctx.lineWidth = 0.8;
      const x = rand() * S;
      const y = rand() * S;
      ctx.beginPath();
      ctx.arc(x, y, 2 + rand() * 6, rand() * 6, rand() * 6 + 1.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Gilt tooling: a double line and a dotted ring just inside the edge.
    const C = S / 2;
    ctx.strokeStyle = "rgba(214,170,92,0.75)";
    ctx.lineWidth = 3;
    for (const r of [C - 14, C - 24]) {
      ctx.beginPath();
      ctx.arc(C, C, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(214,170,92,0.7)";
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(C + Math.cos(a) * (C - 36), C + Math.sin(a) * (C - 36), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, S, S, 12, rand);
    return finish(c);
  });
}

/** Dark slate with faint veins: the runestone's play surface. */
export function slateTexture(): THREE.CanvasTexture {
  return cached("slate", () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S * 0.7);
    g.addColorStop(0, "#2f3442");
    g.addColorStop(1, "#1a1d26");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const rand = seeded(53);
    // Mottling.
    for (let i = 0; i < 160; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 20 + rand() * 90;
      const m = ctx.createRadialGradient(x, y, 0, x, y, r);
      m.addColorStop(0, rand() < 0.5 ? "rgba(70,80,100,0.12)" : "rgba(0,0,0,0.14)");
      m.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = m;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Veins.
    for (let v = 0; v < 9; v++) {
      ctx.strokeStyle = `rgba(150,160,190,${0.05 + rand() * 0.07})`;
      ctx.lineWidth = 0.8 + rand() * 1.4;
      let x = rand() * S;
      let y = rand() * S;
      let a = rand() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 60; s++) {
        a += (rand() - 0.5) * 0.6;
        x += Math.cos(a) * 12;
        y += Math.sin(a) * 12;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    speckle(ctx, S, S, 14, rand);
    return finish(c);
  });
}

// A small alphabet of angular runes, as polylines on a unit box (0..1).
const RUNES: number[][][] = [
  [[0.5, 0, 0.5, 1], [0.5, 0.25, 0.85, 0.05], [0.5, 0.5, 0.85, 0.3]],
  [[0.2, 0, 0.2, 1], [0.2, 0, 0.8, 0.35], [0.8, 0.35, 0.2, 0.65]],
  [[0.5, 0, 0.5, 1], [0.15, 0.3, 0.85, 0.7], [0.85, 0.3, 0.15, 0.7]],
  [[0.2, 1, 0.5, 0], [0.5, 0, 0.8, 1], [0.32, 0.6, 0.68, 0.6]],
  [[0.3, 0, 0.3, 1], [0.7, 0, 0.7, 1], [0.3, 0.5, 0.7, 0.2]],
  [[0.5, 0, 0.15, 0.5], [0.15, 0.5, 0.5, 1], [0.5, 1, 0.85, 0.5], [0.85, 0.5, 0.5, 0]],
  [[0.2, 0, 0.2, 1], [0.2, 0.3, 0.8, 0], [0.2, 0.3, 0.8, 0.6]],
  [[0.5, 0, 0.5, 1], [0.15, 0.2, 0.5, 0.45], [0.85, 0.2, 0.5, 0.45]],
  [[0.2, 0, 0.8, 1], [0.8, 0, 0.2, 1]],
  [[0.5, 0, 0.5, 1], [0.5, 0.5, 0.15, 0.8], [0.5, 0.5, 0.85, 0.8]],
];

function drawRune(ctx: CanvasRenderingContext2D, id: number, size: number) {
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of RUNES[id % RUNES.length]) {
    ctx.moveTo((x1 - 0.5) * size, (y1 - 0.5) * size);
    ctx.lineTo((x2 - 0.5) * size, (y2 - 0.5) * size);
  }
  ctx.stroke();
}

/**
 * Glowing runes around a ring (an emissive map for a RingGeometry, whose UVs are planar like a disc's). `inner` is
 * the ring's inner radius as a fraction of its outer one; the runes sit in the band between.
 */
export function runeRingTexture(inner: number): THREE.CanvasTexture {
  const fr = Math.round(inner * 100) / 100;
  return cached(`runes:${fr}`, () => {
    const S = 2048;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, S, S);
    const C = S / 2;
    const r0 = C * fr;
    const mid = (r0 + C) / 2;
    const band = C - r0;
    ctx.strokeStyle = "#fff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Two fine guide circles.
    ctx.lineWidth = 2;
    for (const r of [r0 + band * 0.14, C - band * 0.14]) {
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(C, C, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const size = band * 0.48;
    const count = Math.floor((Math.PI * 2 * mid) / (size * 1.25));
    const rand = seeded(91);
    ctx.lineWidth = Math.max(2, size * 0.09);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      ctx.save();
      ctx.translate(C + Math.cos(a) * mid, C + Math.sin(a) * mid);
      ctx.rotate(a + Math.PI / 2);
      // Every few runes a diamond stop instead.
      if (i % 9 === 0) {
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.3);
        ctx.lineTo(size * 0.2, 0);
        ctx.lineTo(0, size * 0.3);
        ctx.lineTo(-size * 0.2, 0);
        ctx.closePath();
        ctx.stroke();
      } else drawRune(ctx, Math.floor(rand() * RUNES.length), size);
      ctx.restore();
    }
    return finish(c);
  });
}

/** One rune, glowing white on transparent (tinted by its material): carved on the grove's standing stones. */
export function runeGlyphTexture(id: number): THREE.CanvasTexture {
  const k = id % RUNES.length;
  return cached(`rune:${k}`, () => {
    const S = 128;
    const [c, ctx] = canvas(S);
    ctx.translate(S / 2, S / 2);
    ctx.strokeStyle = "#fff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 12;
    ctx.lineWidth = 9;
    drawRune(ctx, k, 84);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 5;
    drawRune(ctx, k, 84);
    return finish(c);
  });
}

/** A round rug: border bands, a diamond ring and a medallion, with fringe at the very edge. Mapped onto a disc. */
export function rugTexture(): THREE.CanvasTexture {
  return cached("rug", () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    const C = S / 2;
    ctx.clearRect(0, 0, S, S);
    const ring = (r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(C, C, r, 0, Math.PI * 2);
      ctx.fill();
    };
    // Fringe.
    ctx.strokeStyle = "#cdb48a";
    ctx.lineWidth = 2;
    for (let i = 0; i < 520; i++) {
      const a = (i / 520) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * (C - 22), C + Math.sin(a) * (C - 22));
      ctx.lineTo(C + Math.cos(a) * (C - 2), C + Math.sin(a) * (C - 2));
      ctx.stroke();
    }
    ring(C - 20, "#5a1f1c");
    ring(C - 34, "#c49a52");
    ring(C - 40, "#26324a");
    // Diamonds around the outer band.
    ctx.fillStyle = "#c49a52";
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = C - 62;
      ctx.save();
      ctx.translate(C + Math.cos(a) * r, C + Math.sin(a) * r);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(0, -10);
      ctx.lineTo(14, 0);
      ctx.lineTo(0, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ring(C - 86, "#c49a52");
    ring(C - 92, "#6b2420");
    // Field with a faint lattice.
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C - 92, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(196,154,82,0.18)";
    ctx.lineWidth = 3;
    for (let k = -S; k < S * 2; k += 46) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + S, S);
      ctx.moveTo(k + S, 0);
      ctx.lineTo(k, S);
      ctx.stroke();
    }
    ctx.restore();
    ring(C * 0.36, "#c49a52");
    ring(C * 0.34, "#26324a");
    ring(C * 0.2, "#c49a52");
    ring(C * 0.17, "#6b2420");
    const rand = seeded(17);
    speckle(ctx, S, S, 22, rand);
    return finish(c);
  });
}

/** Irregular flagstones with dark mortar. Tiles both ways. */
export function flagstoneTexture(tint: [number, number, number] = [86, 88, 100]): THREE.CanvasTexture {
  return cached(`flags:${tint.join(",")}`, () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = "#121216";
    ctx.fillRect(0, 0, S, S);
    const rand = seeded(tint[0] * 7 + tint[2]);
    const rows = 6;
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * 120;
      while (x < S) {
        const w = 110 + rand() * 120;
        const shade = (rand() - 0.5) * 26;
        const [cr, cg, cb] = tint.map((v) => v + shade);
        const pad = 5;
        const draw = (ox: number) => {
          ctx.fillStyle = rgb(cr, cg, cb);
          ctx.beginPath();
          ctx.roundRect(x + pad + ox, r * rh + pad, w - pad * 2, rh - pad * 2, 10);
          ctx.fill();
          // Worn centre, darker edges.
          const g = ctx.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
          g.addColorStop(0, "rgba(255,255,255,0.05)");
          g.addColorStop(1, "rgba(0,0,0,0.18)");
          ctx.fillStyle = g;
          ctx.fill();
        };
        draw(0);
        if (x + w > S) draw(-S);
        x += w;
      }
    }
    speckle(ctx, S, S, 22, rand);
    return finish(c, { repeat: [1, 1] });
  });
}

/** Lawn: dappled greens with blades. Tiles both ways. */
export function grassTexture(): THREE.CanvasTexture {
  return cached("grass", () => {
    const S = 1024;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = "#1d3420";
    ctx.fillRect(0, 0, S, S);
    const rand = seeded(5);
    for (let i = 0; i < 220; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 30 + rand() * 110;
      for (const ox of [-S, 0, S])
        for (const oy of [-S, 0, S]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, rand() < 0.5 ? "rgba(60,96,50,0.22)" : "rgba(8,20,10,0.25)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
    }
    for (let i = 0; i < 14000; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const l = 4 + rand() * 9;
      const a = -Math.PI / 2 + (rand() - 0.5) * 1.2;
      const k = rand();
      ctx.strokeStyle = k < 0.5 ? `rgba(70,120,60,${0.25 + rand() * 0.3})` : k < 0.85 ? `rgba(30,60,32,${0.3 + rand() * 0.3})` : `rgba(120,150,80,0.25)`;
      ctx.lineWidth = 1 + rand();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    return finish(c, { repeat: [1, 1] });
  });
}

/** Plaster between dark timber posts and a beam (tavern walls). Tiles along u. */
export function timberWallTexture(): THREE.CanvasTexture {
  return cached("timber", () => {
    const W = 1024;
    const H = 1024;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = "#8a7a62";
    ctx.fillRect(0, 0, W, H);
    const rand = seeded(23);
    for (let i = 0; i < 400; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const r = 10 + rand() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rand() < 0.5 ? "rgba(255,240,210,0.08)" : "rgba(40,30,20,0.12)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const timber = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = "#3a2516";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x + w - 6, y, 6, h);
    };
    timber(0, 0, 70, H);
    timber(W / 2 - 35, 0, 70, H);
    timber(0, H * 0.62, W, 54);
    timber(0, H - 60, W, 60);
    // Diagonal braces.
    ctx.strokeStyle = "#3a2516";
    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.moveTo(70, H * 0.62);
    ctx.lineTo(W / 2 - 35, H * 0.25);
    ctx.moveTo(W / 2 + 35, H * 0.25);
    ctx.lineTo(W, H * 0.62);
    ctx.stroke();
    speckle(ctx, W, H, 14, rand);
    return finish(c, { repeat: [1, 1] });
  });
}

/** Rows of book spines in many colours, with shelf boards between rows (the front of a bookcase). */
export function bookshelfTexture(): THREE.CanvasTexture {
  return cached("books", () => {
    const W = 512;
    const H = 1024;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = "#24160d";
    ctx.fillRect(0, 0, W, H);
    const rand = seeded(41);
    const shelves = 6;
    const sh = H / shelves;
    const palette = [
      [110, 30, 34],
      [36, 64, 98],
      [40, 82, 52],
      [120, 86, 40],
      [70, 40, 90],
      [140, 120, 90],
      [30, 30, 36],
      [96, 54, 30],
    ];
    for (let s = 0; s < shelves; s++) {
      const top = s * sh + 10;
      const bottom = (s + 1) * sh - 14;
      let x = 6;
      while (x < W - 10) {
        const w = 12 + rand() * 22;
        const h = (bottom - top) * (0.62 + rand() * 0.36);
        const [r, g, b] = palette[Math.floor(rand() * palette.length)].map((v) => v * (0.8 + rand() * 0.4));
        // Now and then a book leans.
        if (rand() < 0.06 && x < W - 60) {
          ctx.save();
          ctx.translate(x, bottom);
          ctx.rotate(0.3);
          ctx.fillStyle = rgb(r, g, b);
          ctx.fillRect(0, -h, w, h);
          ctx.restore();
          x += w + 18;
          continue;
        }
        ctx.fillStyle = rgb(r, g, b);
        ctx.fillRect(x, bottom - h, w, h);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(x + w - 3, bottom - h, 3, h);
        // Gilt bands on the spine.
        ctx.fillStyle = "rgba(220,180,100,0.55)";
        ctx.fillRect(x + 2, bottom - h + 8, w - 5, 2);
        ctx.fillRect(x + 2, bottom - 12, w - 5, 2);
        if (rand() < 0.5) ctx.fillRect(x + 3, bottom - h * 0.6, w - 7, 5);
        x += w + 1;
      }
      // Shelf board.
      ctx.fillStyle = "#4a2e1a";
      ctx.fillRect(0, (s + 1) * sh - 14, W, 14);
      ctx.fillStyle = "rgba(255,220,170,0.08)";
      ctx.fillRect(0, (s + 1) * sh - 14, W, 3);
    }
    // Side posts.
    ctx.fillStyle = "#3a2414";
    ctx.fillRect(0, 0, 8, H);
    ctx.fillRect(W - 8, 0, 8, H);
    speckle(ctx, W, H, 10, rand);
    return finish(c, { repeat: [1, 1] });
  });
}

/** A glowing summoning circle: rings, a twelve-point star and runes, white on transparent (tinted by material). */
export function magicCircleTexture(): THREE.CanvasTexture {
  return cached("magic-circle", () => {
    const S = 2048;
    const [c, ctx] = canvas(S);
    const C = S / 2;
    ctx.strokeStyle = "#fff";
    ctx.lineCap = "round";
    const circle = (r: number, w: number, a = 1) => {
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(C, C, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    circle(C - 12, 8);
    circle(C - 40, 3, 0.8);
    circle(C - 150, 5);
    circle(C - 172, 2, 0.7);
    // Runes between the outer rings.
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 6;
    const rand = seeded(77);
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.save();
      ctx.translate(C + Math.cos(a) * (C - 95), C + Math.sin(a) * (C - 95));
      ctx.rotate(a + Math.PI / 2);
      drawRune(ctx, Math.floor(rand() * RUNES.length), 60);
      ctx.restore();
    }
    // Twelve-point star (two hexagrams) inside.
    const R = C - 172;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.75;
    for (const step of [5, 4]) {
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const a = ((i * step) % 12) * ((Math.PI * 2) / 12) - Math.PI / 2;
        const x = C + Math.cos(a) * R;
        const y = C + Math.sin(a) * R;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    circle(R * 0.52, 4, 0.8);
    circle(R * 0.48, 2, 0.6);
    // Small circles at the star's points.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(C + Math.cos(a) * R, C + Math.sin(a) * R, 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return finish(c);
  });
}

/**
 * A night sky for the inside of a sphere (equirectangular: v runs from the bottom pole to the top): deep blue to
 * almost black overhead, a faint glow on the horizon, and stars in the upper half.
 */
export function nightSkyTexture(horizon: string, zenith: string): THREE.CanvasTexture {
  return cached(`sky:${horizon}:${zenith}`, () => {
    const W = 2048;
    const H = 1024;
    const [c, ctx] = canvas(W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, zenith);
    g.addColorStop(0.42, zenith);
    g.addColorStop(0.5, horizon);
    g.addColorStop(1, "#05070b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const rand = seeded(3);
    for (let i = 0; i < 1600; i++) {
      const x = rand() * W;
      // Denser towards the top, none below the horizon.
      const y = Math.pow(rand(), 1.3) * H * 0.48;
      const r = rand() < 0.96 ? 0.6 + rand() * 0.9 : 1.6 + rand() * 1.2;
      ctx.fillStyle = `rgba(255,${235 + rand() * 20},${210 + rand() * 45},${0.35 + rand() * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

/** A soft flame (teardrop: white core, warm edge, transparent outside) for additive sprites. */
export function flameTexture(): THREE.CanvasTexture {
  return cached("flame", () => {
    const W = 128;
    const H = 256;
    const [c, ctx] = canvas(W, H);
    const g = ctx.createRadialGradient(W / 2, H * 0.72, 4, W / 2, H * 0.62, H * 0.5);
    g.addColorStop(0, "rgba(255,250,230,1)");
    g.addColorStop(0.25, "rgba(255,200,90,0.95)");
    g.addColorStop(0.6, "rgba(255,110,30,0.45)");
    g.addColorStop(1, "rgba(255,60,10,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(W / 2, 4);
    ctx.bezierCurveTo(W * 0.95, H * 0.45, W * 0.95, H * 0.95, W / 2, H - 4);
    ctx.bezierCurveTo(W * 0.05, H * 0.95, W * 0.05, H * 0.45, W / 2, 4);
    ctx.fill();
    return finish(c);
  });
}

/** The flame on a square canvas, for point sprites (always square on screen). */
export function flameDotTexture(): THREE.CanvasTexture {
  return cached("flame-dot", () => {
    const S = 128;
    const [c, ctx] = canvas(S);
    const g = ctx.createRadialGradient(S / 2, S * 0.68, 2, S / 2, S * 0.6, S * 0.42);
    g.addColorStop(0, "rgba(255,250,230,1)");
    g.addColorStop(0.3, "rgba(255,200,90,0.95)");
    g.addColorStop(0.65, "rgba(255,110,30,0.4)");
    g.addColorStop(1, "rgba(255,60,10,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(S / 2, 6);
    ctx.bezierCurveTo(S * 0.78, S * 0.45, S * 0.78, S * 0.94, S / 2, S - 6);
    ctx.bezierCurveTo(S * 0.22, S * 0.94, S * 0.22, S * 0.45, S / 2, 6);
    ctx.fill();
    return finish(c);
  });
}

/** A round, soft blob for particles (motes, fireflies, sparks). */
export function dotTexture(): THREE.CanvasTexture {
  return cached("dot", () => {
    const S = 64;
    const [c, ctx] = canvas(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return finish(c);
  });
}
