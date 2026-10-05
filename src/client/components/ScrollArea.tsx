// A scrollable region that tells you when there's more below: the bottom edge fades out and a small
// "↓ N more" pill floats there until you're near the end. Used where a panel has to fit the screen
// but its content (a long player list, a tall settings panel) may not.
//
// The wrapper sizes itself like a normal flex child that may shrink (`flex: 0 1 auto`), so inside a
// column with a fixed height the area takes what's left and scrolls; with room to spare it's just
// its content.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "../pack/support";

/** How close to the end (px) still counts as "at the bottom". */
const NEAR_END = 20;

export function ScrollArea({
  children,
  className = "",
  itemSelector,
  noun,
}: {
  children: ReactNode;
  className?: string;
  /** Items to count in the pill ("2 more players"): elements matching this inside the area. */
  itemSelector?: string;
  /** What the items are, singular ("player"). Without it the pill just says "More below". */
  noun?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ below: false, count: 0 });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const below = el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_END;
    let count = 0;
    if (below && itemSelector) {
      const shownEnd = el.scrollTop + el.clientHeight;
      for (const item of el.querySelectorAll<HTMLElement>(itemSelector)) if (item.offsetTop + item.offsetHeight > shownEnd + 2) count++;
    }
    setMore((m) => (m.below === below && m.count === count ? m : { below, count }));
  }, [itemSelector]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const mutate = new MutationObserver(measure);
    mutate.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", measure);
      resize.disconnect();
      mutate.disconnect();
    };
  }, [measure]);

  const scrollDown = () => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.8, behavior: prefersReducedMotion() ? "auto" : "smooth" });

  return (
    <div className={`scroll-wrap ${className}`}>
      <div ref={ref} className={`scroll-area scroll${more.below ? " has-more" : ""}`}>
        {children}
      </div>
      {more.below && (
        <button type="button" className="scroll-more" onClick={scrollDown} aria-label="Scroll down for more">
          <span className="scroll-more-arrow" aria-hidden>
            ↓
          </span>
          {noun && more.count > 0 ? `${more.count} more ${noun}${more.count === 1 ? "" : "s"}` : "More below"}
        </button>
      )}
    </div>
  );
}
