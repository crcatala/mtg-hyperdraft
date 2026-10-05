// Companions' speech bubbles (companionTalk.ts): plain DOM over the whole screen, HUD panels included, so a
// companion standing in a corner of the view can still be read. Each one points at its companion's head, where
// the 3D figure last saw it (bubbleAnchors), and slides sideways to stay inside the window. Small for pokes,
// large and in the emote's colour for emotes. Text is rendered by React, never as HTML.

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { reducedMotion } from "./motion";
import { bubbleAnchors, bubblePop, placeBubble, useBubbles, type Bubble } from "./companionTalk";

/** How far the tail reaches below the bubble's body, in px (kept in step with .speech-bubble in screens.css). */
const TAIL = { small: 9, large: 13 } as const;

export function SpeechBubbles() {
  const bubbles = useBubbles((s) => s.bubbles);
  const els = useRef(new Map<string, HTMLDivElement>());
  const live = Object.entries(bubbles);

  // Placed before the first paint (no flash in the corner), then every frame while any bubble is up.
  useLayoutEffect(() => {
    const live = Object.entries(bubbles);
    if (live.length === 0) return;
    let frame = 0;
    const tick = () => {
      const still = reducedMotion();
      for (const [playerId, b] of live) {
        const el = els.current.get(playerId);
        if (el) place(el, playerId, b, still);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [bubbles]);

  if (live.length === 0) return null;
  return (
    <div className="speech-bubbles" aria-hidden>
      {live.map(([playerId, b]) => (
        <div
          key={b.id}
          ref={(el) => {
            if (el) els.current.set(playerId, el);
            else if (els.current.get(playerId)?.dataset.id === String(b.id)) els.current.delete(playerId);
          }}
          data-id={b.id}
          className={`speech-bubble ${b.size}`}
          style={{ "--tint": b.badge?.color } as CSSProperties}
        >
          {b.badge && (
            <span className="speech-badge">
              <Icon name={b.badge.icon} />
            </span>
          )}
          <span className="speech-text">{b.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Puts a bubble over its companion's head, popped and faded for its age; hidden if the head isn't in view. */
function place(el: HTMLDivElement, playerId: string, b: Bubble, still: boolean) {
  const at = bubbleAnchors.get(playerId);
  if (!at?.on) {
    el.style.opacity = "0";
    return;
  }
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const { left, tail } = placeBubble(at.x, w, window.innerWidth);
  const pop = bubblePop(performance.now() - b.at, still, b.size);
  el.style.setProperty("--tail", `${tail}px`);
  el.style.transformOrigin = `${tail}px ${h + TAIL[b.size]}px`;
  el.style.transform = `translate(${left}px, ${at.y - h - TAIL[b.size]}px) rotate(${pop.rot}rad) scale(${pop.scale})`;
  el.style.opacity = String(pop.alpha);
}
