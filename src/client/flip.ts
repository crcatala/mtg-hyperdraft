// FLIP animations for elements that move (and resize) between renders:
// First (snapshot rects) → Last (after React commits) → Invert (transform back) → Play (to none).

export type RectSnapshot = Map<string, DOMRect>;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Records the on-screen rect of every element matching `selector`, keyed by `data-{attr}`. */
export function snapshotRects(selector: string, attr: string): RectSnapshot {
  const map: RectSnapshot = new Map();
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const key = el.dataset[attr];
    if (key) map.set(key, el.getBoundingClientRect());
  });
  return map;
}

export interface FlipOptions {
  /** Keys that changed container; they animate longer and on top. */
  emphasize?: Set<string>;
  duration?: number;
  emphasizedDuration?: number;
}

/**
 * Animates every element from its snapshotted rect to where it is now. Call it in a
 * requestAnimationFrame after the state change, so layout (including follow-up renders such as
 * auto-sizing) has settled but nothing has been painted yet.
 */
export function playFlip(before: RectSnapshot, selector: string, attr: string, opts: FlipOptions = {}) {
  if (reducedMotion()) return;
  const { emphasize = new Set(), duration = 240, emphasizedDuration = 380 } = opts;
  // Measure everything before starting any animation: each animate() dirties style, so
  // interleaving reads and writes forces a full layout per element.
  const items: { el: HTMLElement; key: string; to: DOMRect }[] = [];
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const key = el.dataset[attr];
    if (key) items.push({ el, key, to: el.getBoundingClientRect() });
  });
  for (const { el, key, to } of items) {
    const from = before.get(key);
    if (!from) {
      el.animate([{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], { duration, easing: "ease-out" });
      continue;
    }
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const scale = to.width > 0 ? from.width / to.width : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) continue;

    const hero = emphasize.has(key);
    if (hero) el.style.zIndex = "200";
    const anim = el.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${scale})`, ...(hero ? { filter: "drop-shadow(0 18px 28px rgba(0,0,0,0.55))" } : {}) },
        { transformOrigin: "0 0", transform: "none", ...(hero ? { filter: "none" } : {}) },
      ],
      { duration: hero ? emphasizedDuration : duration, easing: hero ? "cubic-bezier(0.2, 0.9, 0.25, 1)" : "cubic-bezier(0.25, 0.8, 0.25, 1)" },
    );
    if (hero) {
      const reset = () => (el.style.zIndex = "");
      anim.onfinish = reset;
      anim.oncancel = reset;
    }
  }
}
