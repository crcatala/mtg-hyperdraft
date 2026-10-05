// Companions' speech bubbles (companionTalk.ts): plain DOM over the whole screen, HUD panels included, so a
// companion standing in a corner of the view can still be read. Each one points at its companion's head, where
// the 3D figure last saw it (bubbleAnchors), slides sideways to stay inside the window, and goes under the
// companion instead when it's too near the top. Small for pokes,
// large and in the emote's colour for emotes. Text is rendered by React, never as HTML.
//
// The bubbles themselves are hidden from screen readers (pokes would chatter); emotes, which are messages to the
// table, are read out politely through a visually hidden live region instead. With companion speech off
// (companionPrefs.ts) there are no bubbles, and so nothing to read out.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { companionDef } from "../../shared/roster";
import { useCompanionPrefs } from "../companionPrefs";
import { useStore } from "../store";
import { reducedMotion } from "./motion";
import { bubbleAnchors, bubblePop, placeBubble, useBubbles, type Bubble } from "./companionTalk";

/** How far the tail reaches below the bubble's body, in px (kept in step with .speech-bubble in screens.css). */
const TAIL = { small: 9, large: 13 } as const;

export function SpeechBubbles() {
  const bubbles = useBubbles((s) => s.bubbles);
  const speech = useCompanionPrefs().speech;
  const els = useRef(new Map<string, HTMLDivElement>());
  const live = speech ? Object.entries(bubbles) : [];

  // Placed before the first paint (no flash in the corner), then every frame while any bubble is up.
  useLayoutEffect(() => {
    const live = speech ? Object.entries(bubbles) : [];
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
  }, [bubbles, speech]);

  return (
    <>
      <EmoteAnnouncer />
      {live.length > 0 && <Bubbles live={live} els={els.current} />}
    </>
  );
}

function Bubbles({ live, els }: { live: [string, Bubble][]; els: Map<string, HTMLDivElement> }) {
  return (
    <div className="speech-bubbles" aria-hidden>
      {live.map(([playerId, b]) => (
        <div
          key={b.id}
          ref={(el) => {
            if (el) els.set(playerId, el);
            else if (els.get(playerId)?.dataset.id === String(b.id)) els.delete(playerId);
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

/**
 * Reads each new emote out once, as "Alice's Hex: Ten lives. You have one.", through a polite live region that is
 * always mounted (a region that appears along with its text isn't announced). Pokes and pick-ups are left out.
 */
function EmoteAnnouncer() {
  const bubbles = useBubbles((s) => s.bubbles);
  const [said, setSaid] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    const next = nextAnnouncement(bubbles, said?.id ?? 0);
    if (!next) return;
    const player = useStore.getState().view?.players.find((p) => p.id === next.playerId);
    setSaid({ id: next.bubble.id, text: announcement(player?.name, companionDef(player?.companion)?.name, next.bubble.text) });
  }, [bubbles, said]);
  return (
    <div className="sr-only" role="log" aria-live="polite" aria-label="Companion emotes">
      {said && <p key={said.id}>{said.text}</p>}
    </div>
  );
}

/** The newest emote (large) bubble put up after bubble `after`, if any: pokes and pick-ups aren't read out. */
export function nextAnnouncement(bubbles: Record<string, Bubble>, after: number): { playerId: string; bubble: Bubble } | undefined {
  let next: { playerId: string; bubble: Bubble } | undefined;
  for (const [playerId, bubble] of Object.entries(bubbles)) {
    if (bubble.size === "large" && bubble.id > after && (!next || bubble.id > next.bubble.id)) next = { playerId, bubble };
  }
  return next;
}

/** How an emote is read out: "Alice's Hex: Ten lives. You have one." */
export const announcement = (player: string | undefined, companion: string | undefined, text: string): string =>
  `${player && companion ? `${player}'s ${companion}` : (companion ?? "A companion")}: ${text}`;

/** Puts a bubble over its companion's head, popped and faded for its age; hidden if the head isn't in view. */
function place(el: HTMLDivElement, playerId: string, b: Bubble, still: boolean) {
  const at = bubbleAnchors.get(playerId);
  if (!at?.on) {
    el.style.opacity = "0";
    return;
  }
  const h = el.offsetHeight;
  const tailSize = TAIL[b.size];
  const spot = placeBubble(at, el.offsetWidth, h, tailSize, window.innerWidth, window.innerHeight);
  const pop = bubblePop(performance.now() - b.at, still, b.size);
  el.classList.toggle("below", spot.below);
  el.style.setProperty("--tail", `${spot.tail}px`);
  // It pops from its tail's tip.
  el.style.transformOrigin = `${spot.tail}px ${spot.below ? -tailSize : h + tailSize}px`;
  el.style.transform = `translate(${spot.left}px, ${spot.top}px) rotate(${pop.rot}rad) scale(${pop.scale})`;
  el.style.opacity = String(pop.alpha);
}
