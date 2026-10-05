// Background music: one playlist that plays straight through the whole visit (title screen, lobby,
// draft, deckbuilding, table), because the audio element lives here and not in any screen. It's
// separate from sound effects (sfx.ts, soundPacks.ts): its own on/off, its own volume and mute (what
// you hear is that times the master volume, volume.ts).
//
// On load it tries to start straight away. Browsers refuse that until the player has interacted with
// the page, in which case the first click or key press anywhere starts it. A pause is remembered, so
// next time it stays quiet. Tracks are streamed from public/music/ through one
// <audio> element, which is what makes scrubbing cheap.

import { useSyncExternalStore } from "react";
import { getVolumes, onVolumes } from "./volume";

/** The playlist, in play order. `file` is in public/music/. */
export const TRACKS = [
  { id: "shuffle-and-cut", title: "Shuffle & Cut", file: "shuffle-and-cut.m4a" },
  { id: "first-pick-second-guess", title: "First Pick, Second Guess", file: "first-pick-second-guess.m4a" },
  { id: "planeswalkers-stroll", title: "Planeswalker's Stroll", file: "planeswalkers-stroll.m4a" },
  { id: "cardboard-kingdom", title: "Cardboard Kingdom", file: "cardboard-kingdom.m4a" },
  { id: "clockwork-charge", title: "Clockwork Charge", file: "clockwork-charge.m4a" },
  { id: "sideboard-serenade", title: "Sideboard Serenade", file: "sideboard-serenade.m4a" },
  { id: "sealed-pool-expedition", title: "Sealed Pool Expedition", file: "sealed-pool-expedition.m4a" },
] as const;

/** localStorage key for the saved MusicPrefs (JSON). */
export const MUSIC_KEY = "hd.music";

export interface MusicPrefs {
  /** The player wants music: it starts on the first interaction, and a pause turns it off for next time too. */
  on: boolean;
  /** 0–1, before the master volume. */
  volume: number;
  /** Silenced (the speaker button) without pausing: the track plays on, unheard. */
  muted: boolean;
  /** The player widget is expanded (not minimized). */
  open: boolean;
}
export const DEFAULT_PREFS: MusicPrefs = { on: true, volume: 0.5, muted: false, open: false };

/** Saved prefs from storage text; anything missing or malformed falls back to the default. */
export function parsePrefs(raw: string | null | undefined): MusicPrefs {
  let v: Partial<Record<keyof MusicPrefs, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") v = parsed;
  } catch {
    // Corrupt: the defaults it is.
  }
  return {
    on: typeof v.on === "boolean" ? v.on : DEFAULT_PREFS.on,
    volume: typeof v.volume === "number" && Number.isFinite(v.volume) ? Math.min(1, Math.max(0, v.volume)) : DEFAULT_PREFS.volume,
    muted: typeof v.muted === "boolean" ? v.muted : DEFAULT_PREFS.muted,
    open: typeof v.open === "boolean" ? v.open : DEFAULT_PREFS.open,
  };
}

/** The track `dir` steps from `index`, wrapping around the playlist. */
export function stepIndex(index: number, count: number, dir: 1 | -1): number {
  return (((index + dir) % count) + count) % count;
}

/** Past this many seconds in, "previous" restarts the track instead of going back one. */
export const RESTART_AFTER = 3;

/** 83.4 → "1:23"; unknown or negative times read as "0:00". */
export function formatTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// --- state ---------------------------------------------------------------------------------------

export interface MusicState extends MusicPrefs {
  /** Index into TRACKS. */
  index: number;
  /** Audio is actually playing right now (false while paused, or while the browser is waiting for a first click). */
  playing: boolean;
  /** Every track failed to load in a row. */
  failed: boolean;
}

const listeners = new Set<() => void>();
const timeListeners = new Set<() => void>();
let state: MusicState = { ...DEFAULT_PREFS, index: 0, playing: false, failed: false };
let clock = { time: 0, duration: 0 };
let audioEl: HTMLAudioElement | null = null;
let started = false;
let failures = 0;

function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function savePrefs() {
  try {
    const { on, volume, muted, open } = state;
    localStorage.setItem(MUSIC_KEY, JSON.stringify({ on, volume, muted, open } satisfies MusicPrefs));
  } catch {
    // Not remembered, still applied.
  }
}

function setClock(time: number, duration: number) {
  clock = { time, duration: Number.isFinite(duration) ? duration : 0 };
  timeListeners.forEach((l) => l());
}

function audio(): HTMLAudioElement {
  if (audioEl) return audioEl;
  const el = new Audio();
  el.preload = "none";
  audioEl = el;
  applyLevel();
  el.addEventListener("play", () => set({ playing: true, failed: false }));
  el.addEventListener("pause", () => set({ playing: false }));
  el.addEventListener("playing", () => (failures = 0));
  el.addEventListener("ended", () => step(1));
  el.addEventListener("timeupdate", () => setClock(el.currentTime, el.duration));
  el.addEventListener("loadedmetadata", () => setClock(el.currentTime, el.duration));
  el.addEventListener("durationchange", () => setClock(el.currentTime, el.duration));
  el.addEventListener("error", () => {
    // A track that won't load is skipped, unless none will (then stop rather than spin).
    if (++failures >= TRACKS.length) return set({ failed: true, playing: false });
    step(1);
  });
  return el;
}

/** What comes out of the speakers: the music's own volume × the master volume, or nothing while muted. */
function applyLevel() {
  if (!audioEl) return;
  audioEl.volume = state.volume * getVolumes().master;
  audioEl.muted = state.muted;
}

function load(index: number) {
  const el = audio();
  el.src = `/music/${TRACKS[index].file}`;
  started = true;
  setClock(0, 0);
  set({ index });
  updateMediaSession();
}

/** Plays the current track (loading it first if nothing has been yet). Resolves false if the browser refused. */
function start(): Promise<boolean> {
  const el = audio();
  if (!started) load(state.index);
  return el.play().then(
    () => true,
    () => false,
  );
}

function step(dir: 1 | -1) {
  load(stepIndex(state.index, TRACKS.length, dir));
  if (state.on) void start();
}

// --- controls ------------------------------------------------------------------------------------

export function playMusic() {
  set({ on: true, failed: false });
  failures = 0;
  savePrefs();
  void start().then((ok) => ok || armFirstGesture());
}

export function pauseMusic() {
  set({ on: false });
  savePrefs();
  audioEl?.pause();
}

export function toggleMusic() {
  if (state.on && state.playing) pauseMusic();
  else playMusic();
}

export function nextTrack() {
  step(1);
}

/** Restarts the track if it's well under way, otherwise goes back one. */
export function prevTrack() {
  if (audioEl && audioEl.currentTime > RESTART_AFTER) seekMusic(0);
  else step(-1);
}

export function selectTrack(index: number) {
  if (index === state.index && started) {
    if (!state.playing) playMusic();
    return;
  }
  failures = 0;
  set({ on: true, failed: false });
  savePrefs();
  load(index);
  void start().then((ok) => ok || armFirstGesture());
}

export function seekMusic(sec: number) {
  if (!audioEl || !started) return;
  audioEl.currentTime = sec;
  setClock(sec, audioEl.duration);
}

export function setMusicVolume(v: number) {
  const volume = Math.min(1, Math.max(0, v));
  // Dragging the slider up from a mute un-mutes, like every volume control.
  set({ volume, muted: state.muted && volume === 0 });
  applyLevel();
  savePrefs();
}

export function setMusicMuted(muted: boolean) {
  set({ muted });
  applyLevel();
  savePrefs();
  // Un-muting is a click, so it can also get music going that was waiting on one.
  if (!muted && state.on && !state.playing) void start().then((ok) => ok || armFirstGesture());
}

export function setPlayerOpen(open: boolean) {
  set({ open });
  savePrefs();
}

// --- startup -------------------------------------------------------------------------------------

let armed = false;

/** Waits for the first click or key press (autoplay rules), then starts the music if it's wanted. */
function armFirstGesture() {
  if (armed) return;
  armed = true;
  const events = ["pointerdown", "keydown"] as const;
  const go = (e: Event) => {
    // A click on the player's own Play/Pause does its own thing (this must not start the music just for that to pause it).
    if ((e.target as Element | null)?.closest?.("[data-music-toggle]")) return;
    if (!state.on || state.playing) return disarm();
    void start().then((ok) => ok && disarm());
  };
  const disarm = () => {
    events.forEach((t) => window.removeEventListener(t, go, true));
    armed = false;
  };
  events.forEach((t) => window.addEventListener(t, go, true));
}

/** Startup: reads the saved prefs, picks a track to open with, and arms the first-interaction start. */
export function initMusic() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(MUSIC_KEY);
  } catch {
    // Storage blocked: the defaults it is.
  }
  // The dev pages (icon gallery, Sound Studio) are for looking and listening: no music there.
  const dev = location.pathname.startsWith("/dev/");
  set({ ...parsePrefs(saved), index: Math.floor(Math.random() * TRACKS.length) });
  onVolumes(applyLevel);
  if (!state.on || dev) return;
  // Try straight away (it works if the browser allows it); if not, wait for the first interaction.
  void start().then((ok) => ok || armFirstGesture());
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const t = TRACKS[state.index];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "HyperDraft", album: "Draft Night" });
  navigator.mediaSession.setActionHandler("play", playMusic);
  navigator.mediaSession.setActionHandler("pause", pauseMusic);
  navigator.mediaSession.setActionHandler("previoustrack", prevTrack);
  navigator.mediaSession.setActionHandler("nexttrack", nextTrack);
}

// --- hooks ---------------------------------------------------------------------------------------

export function useMusic(): MusicState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** Playback position and track length in seconds; updates several times a second, so only the scrubber uses it. */
export function useMusicClock(): { time: number; duration: number } {
  return useSyncExternalStore(
    (cb) => {
      timeListeners.add(cb);
      return () => timeListeners.delete(cb);
    },
    () => clock,
  );
}
