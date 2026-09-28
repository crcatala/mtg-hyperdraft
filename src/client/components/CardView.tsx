// A card in the DOM: text-rendered frame first, real Scryfall image fades in when it loads.
// Rarity adds a glow ring; mythics and foils get a holographic layer that follows the mouse tilt.

import { memo, useLayoutEffect, useRef, useState, type HTMLAttributes, type PointerEvent } from "react";
import type { CardData, TokenDef } from "../../shared/types";
import { faceOf, frameColors, hasBackFace, imageUrl, nextFace, type ImageSize } from "../cardStyle";
import { useStore } from "../store";
import { ManaCost, RulesText } from "./Mana";
import { imageStatus, useImage } from "../imageCache";
import { Icon } from "./Icon";
import { cardTypeIcon } from "../icons";

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
  /**
   * Double-faced cards get a "turn over" button. Without `onFlip` the card flips itself (local view
   * state); with `onFlip` the parent owns the face and passes it back in via `face`.
   */
  flippable?: boolean;
  onFlip?: () => void;
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
  flippable,
  onFlip,
  className = "",
  style,
  onPointerMove: userPointerMove,
  onPointerLeave: userPointerLeave,
  ...rest
}: CardViewProps) {
  const forceText = useStore((s) => s.debug.forceText);
  const [turned, setTurned] = useState(false);
  const dfc = !back && hasBackFace(card);
  const canFlip = !!flippable && dfc;
  if (canFlip && !onFlip && turned) face = nextFace(card, face);
  // One size ("normal", 488px) for everything except big zoomed views, so each card downloads once.
  const size: ImageSize = imageSize ?? (width > 420 ? "large" : "normal");
  const url = back || forceText ? undefined : imageUrl(card, face, size);
  const status = useImage(url);
  // Only fade in images that arrive after mount; cached ones appear instantly.
  const [fadeIn] = useState(() => imageStatus(url) !== "loaded");
  // Which image has finished fading in (turning a double-faced card over loads another one).
  const [fadedIn, setFadedIn] = useState<string>();
  // Once the image covers the card, drop the text version underneath: laying out and painting
  // hidden rules text for every card made re-sizing many cards at once (deckbuilder) slow.
  const imageShown = !!url && status === "loaded";
  const showText = !imageShown || (fadeIn && fadedIn !== url);
  const ref = useRef<HTMLDivElement>(null);

  // Turning over: swing the new face in edge-on (skipped on mount and for reduced motion).
  const lastFace = useRef(face);
  useLayoutEffect(() => {
    if (lastFace.current === face) return;
    lastFace.current = face;
    const inner = ref.current?.querySelector<HTMLElement>(".card-inner");
    if (!inner || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    inner.animate([{ transform: "rotateY(90deg) scale(0.97)" }, { transform: "rotateY(0deg)" }], { duration: 300, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.15)" });
  }, [face]);

  const rarity = card?.rarity ?? "common";
  const shiny = !back && (foil || rarity === "mythic");

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    userPointerMove?.(e);
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
  const onLeave = (e: PointerEvent<HTMLDivElement>) => {
    userPointerLeave?.(e);
    if (!tilt || !ref.current) return;
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
    dfc ? "dfc" : "",
    className,
  ].join(" ");

  return (
    <div
      ref={ref}
      className={classes}
      style={{ width, ...style }}
      onPointerMove={tilt || userPointerMove ? onMove : undefined}
      onPointerLeave={tilt || userPointerLeave ? onLeave : undefined}
      {...rest}
    >
      <div className="card-inner">
        {showText &&
          (back ? (
            <CardBack />
          ) : card ? (
            <TextCard card={card} face={face} />
          ) : token ? (
            <TokenCard token={token} />
          ) : (
            <CardBack />
          ))}
        {imageShown && (
          <img
            className={`card-img${fadeIn ? " fade-in" : ""}`}
            src={url}
            crossOrigin="anonymous"
            alt={card?.name}
            draggable={false}
            onAnimationEnd={() => setFadedIn(url)}
          />
        )}
        {shiny && <div className="holo" />}
        {tilt && !back && <div className="glare" />}
      </div>
      {canFlip && (
        <button
          type="button"
          className="dfc-flip"
          title={`Turn over — show ${face === 0 ? "the back" : "the front"} face`}
          aria-label="Turn card over"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (onFlip) onFlip();
            else setTurned((t) => !t);
          }}
        >
          <Icon name="flip" />
        </button>
      )}
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
        <Icon name={cardTypeIcon(f.typeLine)} />
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
        <Icon name="sparkle" />
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
