// A card in the DOM: text-rendered frame first, real Scryfall image fades in when it loads.
// Rarity adds a glow ring; mythics and foils get a holographic layer that follows the mouse tilt.

import { memo, useRef, useState, type HTMLAttributes, type PointerEvent } from "react";
import type { CardData, TokenDef } from "../../shared/types";
import { faceOf, frameColors, imageUrl, type ImageSize } from "../cardStyle";
import { useStore } from "../store";
import { ManaCost, RulesText } from "./Mana";
import { imageStatus, useImage } from "../imageCache";

export interface CardViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  card?: CardData;
  token?: TokenDef;
  face?: number;
  foil?: boolean;
  /** Show the card back instead. */
  back?: boolean;
  width?: number;
  tilt?: boolean;
  imageSize?: ImageSize;
  selected?: boolean;
  dim?: boolean;
  glow?: boolean;
}

export const CardView = memo(function CardView({
  card,
  token,
  face = 0,
  foil,
  back,
  width = 200,
  tilt,
  imageSize,
  selected,
  dim,
  glow = true,
  className = "",
  style,
  ...rest
}: CardViewProps) {
  const forceText = useStore((s) => s.debug.forceText);
  // One size ("normal", 488px) for everything except big zoomed views, so each card downloads once.
  const size: ImageSize = imageSize ?? (width > 420 ? "large" : "normal");
  const url = back || forceText ? undefined : imageUrl(card, face, size);
  const status = useImage(url);
  // Only fade in images that arrive after mount; cached ones appear instantly.
  const [fadeIn] = useState(() => imageStatus(url) !== "loaded");
  const ref = useRef<HTMLDivElement>(null);

  const rarity = card?.rarity ?? "common";
  const shiny = !back && (foil || rarity === "mythic");

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!tilt || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ref.current.style.setProperty("--mx", `${px * 100}%`);
    ref.current.style.setProperty("--my", `${py * 100}%`);
    ref.current.style.setProperty("--rx", `${(0.5 - py) * 18}deg`);
    ref.current.style.setProperty("--ry", `${(px - 0.5) * 22}deg`);
    ref.current.style.setProperty("--hyp", `${Math.min(1, Math.hypot(px - 0.5, py - 0.5) * 2)}`);
  };
  const onLeave = () => {
    if (!ref.current) return;
    ref.current.style.setProperty("--rx", "0deg");
    ref.current.style.setProperty("--ry", "0deg");
    ref.current.style.setProperty("--hyp", "0");
  };

  const classes = [
    "card",
    back ? "is-back" : `r-${rarity}`,
    glow && !back ? "glow" : "",
    shiny ? "shiny" : "",
    foil ? "foil" : "",
    tilt ? "tilt" : "",
    selected ? "selected" : "",
    dim ? "dim" : "",
    className,
  ].join(" ");

  return (
    <div
      ref={ref}
      className={classes}
      style={{ width, ...style }}
      onPointerMove={tilt ? onMove : undefined}
      onPointerLeave={tilt ? onLeave : undefined}
      {...rest}
    >
      <div className="card-inner">
        {back ? (
          <CardBack />
        ) : card ? (
          <TextCard card={card} face={face} />
        ) : token ? (
          <TokenCard token={token} />
        ) : (
          <CardBack />
        )}
        {url && status === "loaded" && (
          <img className={`card-img${fadeIn ? " fade-in" : ""}`} src={url} crossOrigin="anonymous" alt={card?.name} draggable={false} />
        )}
        {shiny && <div className="holo" />}
        {tilt && !back && <div className="glare" />}
      </div>
    </div>
  );
});

export function TextCard({ card, face = 0 }: { card: CardData; face?: number }) {
  const f = faceOf(card, face);
  const colors = frameColors({ colors: f.colors, typeLine: f.typeLine });
  const pt = f.power !== undefined ? `${f.power}/${f.toughness}` : f.loyalty ?? null;
  return (
    <div className="text-card" style={{ "--frame": colors.frame, "--inner": colors.inner, "--ink": colors.text, "--accent": colors.accent } as React.CSSProperties}>
      <div className="tc-name">
        <span className="tc-title">{f.name}</span>
        <ManaCost cost={f.manaCost} shadow />
      </div>
      <div className="tc-art">
        <span>{glyphFor(f.typeLine)}</span>
      </div>
      <div className="tc-type">
        <span>{f.typeLine}</span>
        <span className={`tc-rarity r-${card.rarity}`}>{card.set.toUpperCase()}</span>
      </div>
      <div className="tc-text">
        <RulesText text={f.oracleText} />
      </div>
      {pt && <div className="tc-pt">{pt}</div>}
    </div>
  );
}

function TokenCard({ token }: { token: TokenDef }) {
  const colors = frameColors({ colors: token.colors, typeLine: "Token" });
  return (
    <div className="text-card token" style={{ "--frame": colors.frame, "--inner": colors.inner, "--ink": colors.text, "--accent": colors.accent } as React.CSSProperties}>
      <div className="tc-name">
        <span className="tc-title">{token.name}</span>
      </div>
      <div className="tc-art tall">
        <span>✦</span>
      </div>
      <div className="tc-type">
        <span>Token</span>
      </div>
      {token.text && (
        <div className="tc-text">
          <RulesText text={token.text} />
        </div>
      )}
      {token.power !== undefined && <div className="tc-pt">{`${token.power}/${token.toughness ?? "0"}`}</div>}
    </div>
  );
}

export function CardBack() {
  return (
    <div className="card-back">
      <div className="cb-ring" />
      <div className="cb-logo">
        <span>Hyper</span>
        <span>Draft</span>
      </div>
    </div>
  );
}

function glyphFor(typeLine: string): string {
  if (/Planeswalker/.test(typeLine)) return "✧";
  if (/Creature/.test(typeLine)) return "⚔";
  if (/Instant/.test(typeLine)) return "ϟ";
  if (/Sorcery/.test(typeLine)) return "✺";
  if (/Enchantment/.test(typeLine)) return "❂";
  if (/Artifact/.test(typeLine)) return "⚙";
  if (/Land/.test(typeLine)) return "⛰";
  return "◆";
}
