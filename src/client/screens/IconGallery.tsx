// /dev/icons: every icon in our set, for designing new ones and checking how they render.
// Toggle between the DOM <svg> renderer and the canvas one (3D labels, text-only card art) to
// compare them; click a tile to copy its <Icon /> snippet.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { drawIcon, ICON_STROKE, ICONS, type IconName } from "../icons";
import { navigate } from "../router";
import { useStore } from "../store";

const NAMES = Object.keys(ICONS) as IconName[];
const SMALL_SIZES = [16, 20, 24];
const COLORS = [
  { name: "Text", css: "--text" },
  { name: "Muted", css: "--muted" },
  { name: "Gold", css: "--gold" },
  { name: "Violet", css: "--violet-2" },
  { name: "Cyan", css: "--cyan" },
  { name: "Green", css: "--green" },
  { name: "Red", css: "--red" },
];

type Renderer = "svg" | "canvas";

export function IconGallery() {
  const toast = useStore((s) => s.toast);
  const [query, setQuery] = useState("");
  const [size, setSize] = useState(40);
  const [stroke, setStroke] = useState(ICON_STROKE);
  const [color, setColor] = useState(COLORS[0].css);
  const [renderer, setRenderer] = useState<Renderer>("svg");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => NAMES.filter((n) => n.includes(q)), [q]);
  // Canvas can't read CSS variables, so resolve the swatch to a concrete colour.
  const resolved = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue(color).trim() || "#fff", [color]);

  const copy = async (name: IconName) => {
    const snippet = `<Icon name="${name}" />`;
    try {
      await navigator.clipboard.writeText(snippet);
      toast(`Copied ${snippet}`);
    } catch {
      toast(snippet);
    }
  };

  const render = (name: IconName, px: number) =>
    renderer === "svg" ? <Icon name={name} style={{ fontSize: px }} /> : <CanvasIcon name={name} size={px} color={resolved} stroke={stroke} />;

  return (
    <div className="screen icon-gallery" style={{ "--icon-stroke": stroke } as React.CSSProperties}>
      <header className="topbar">
        <span className="brand" role="link" style={{ cursor: "pointer" }} onClick={() => navigate("/")} title="Home">
          HyperDraft
        </span>
        <span className="topbar-title">Icons</span>
        <span className="faint">
          {shown.length === NAMES.length ? NAMES.length : `${shown.length} / ${NAMES.length}`} icons · 24×24 grid
        </span>
      </header>

      <div className="ig-controls">
        <input className="input ig-search" placeholder="Filter by name…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <label className="ig-control">
          <span className="label">Size {size}px</span>
          <input type="range" min={12} max={96} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <label className="ig-control">
          <span className="label">Stroke {stroke}</span>
          <input type="range" min={1} max={3} step={0.25} value={stroke} onChange={(e) => setStroke(Number(e.target.value))} />
        </label>
        <div className="ig-control">
          <span className="label">Colour</span>
          <div className="ig-swatches">
            {COLORS.map((c) => (
              <button key={c.css} className={`ig-swatch${color === c.css ? " on" : ""}`} style={{ background: `var(${c.css})` }} title={c.name} aria-label={c.name} aria-pressed={color === c.css} onClick={() => setColor(c.css)} />
            ))}
          </div>
        </div>
        <div className="ig-control">
          <span className="label">Renderer</span>
          <div className="ig-segmented" role="group" aria-label="Renderer">
            {(["svg", "canvas"] as const).map((r) => (
              <button key={r} className={`btn small${renderer === r ? " on" : ""}`} aria-pressed={renderer === r} onClick={() => setRenderer(r)}>
                {r === "svg" ? "SVG" : "Canvas"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="ig-grid scroll" style={{ color: `var(${color})` }}>
        {shown.map((name) => (
          <button key={name} className="ig-tile" onClick={() => copy(name)} title={`Copy <Icon name="${name}" />`}>
            <span className="ig-big" style={{ height: size }}>
              {render(name, size)}
            </span>
            <span className="ig-small">{SMALL_SIZES.map((px) => <span key={px}>{render(name, px)}</span>)}</span>
            <code className="ig-name">{name}</code>
          </button>
        ))}
        {shown.length === 0 && <p className="muted">No icons match “{query}”.</p>}
      </main>
    </div>
  );
}

/** An icon drawn with the canvas renderer (as the 3D table does), crisp on high-DPI screens. */
function CanvasIcon({ name, size, color, stroke }: { name: IconName; size: number; color: string; stroke: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    // Room for strokes that poke past the 24×24 box, like the SVG's overflow: visible.
    const pad = Math.ceil(size * 0.1);
    c.width = Math.ceil((size + pad * 2) * dpr);
    c.height = c.width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size + pad * 2, size + pad * 2);
    drawIcon(ctx, name, pad, pad, size, color, stroke);
    c.style.width = c.style.height = `${size + pad * 2}px`;
    c.style.margin = `${-pad}px`;
  }, [name, size, color, stroke]);
  return <canvas ref={ref} className="ig-canvas" />;
}
