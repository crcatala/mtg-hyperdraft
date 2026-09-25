// One shared, decoded HTMLImageElement per card image URL.
// DOM cards and 3D textures both go through here, so each image is downloaded once per page:
// every request uses the same CORS mode (anonymous), and remounting a card never re-fetches.

import { useEffect, useState } from "react";

export type ImageStatus = "loading" | "loaded" | "error";

interface Entry {
  img: HTMLImageElement;
  status: ImageStatus;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

export function loadImage(url: string): Entry {
  let e = entries.get(url);
  if (e) return e;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  const entry: Entry = { img, status: "loading", listeners: new Set() };
  const settle = (status: ImageStatus) => {
    entry.status = status;
    entry.listeners.forEach((l) => l());
    entry.listeners.clear();
  };
  img.onload = () => {
    // Decode off the main thread before announcing, so swapping it in doesn't jank animations.
    img.decode().then(
      () => settle("loaded"),
      () => settle("loaded"),
    );
  };
  img.onerror = () => settle("error");
  img.src = url;
  entries.set(url, entry);
  return entry;
}

export function imageStatus(url: string | undefined): ImageStatus | undefined {
  return url ? entries.get(url)?.status : undefined;
}

/** Starts (or reuses) the load for `url` and re-renders when it settles. */
export function useImage(url: string | undefined): ImageStatus | undefined {
  const [, bump] = useState(0);
  const entry = url ? loadImage(url) : undefined;
  useEffect(() => {
    if (!entry || entry.status !== "loading") return;
    const l = () => bump((n) => n + 1);
    entry.listeners.add(l);
    return () => void entry.listeners.delete(l);
  }, [entry]);
  return entry?.status;
}

/** Calls back once the image is ready (immediately if already cached). */
export function whenLoaded(url: string, cb: (img: HTMLImageElement) => void) {
  const entry = loadImage(url);
  if (entry.status === "loaded") cb(entry.img);
  else if (entry.status === "loading") entry.listeners.add(() => entry.status === "loaded" && cb(entry.img));
}

export function cachedImageCount(): number {
  return entries.size;
}
