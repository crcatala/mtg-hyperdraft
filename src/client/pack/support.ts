// Whether the 3D pack can be used here. When it can't (no WebGL, or it fails at runtime) the Draft
// screen falls back to the plain CSS pack, which has the same click-to-open behaviour.

let cached: boolean | null = null;

// ?pack=css forces the simple pack (handy on a struggling GPU, and for testing the fallback). Read
// once at startup: the router rewrites the URL before the Draft screen ever asks.
const forceSimple = typeof location !== "undefined" && new URLSearchParams(location.search).get("pack") === "css";

export function canUse3d(): boolean {
  if (forceSimple) return false;
  if (cached !== null) return cached;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    cached = !!gl;
    // Free the probe's context straight away: browsers only allow a handful of live ones.
    (gl?.getExtension("WEBGL_lose_context") as { loseContext(): void } | null)?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}

/** Packs are only torn by hand for people who haven't asked for less motion. */
export function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Whether to show the 3D pack. It needs WebGL, and it's all motion (the drop-in, the tear, the burst),
 * so with reduced motion the CSS pack is used: opening it skips straight to the revealed cards.
 */
export function wants3dPack(webgl: boolean, reducedMotion: boolean): boolean {
  return webgl && !reducedMotion;
}
