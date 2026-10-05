// Player-facing settings: a modal with a tab per group (Appearance, Sound, ...). It's mounted once in
// App and opened from the gear in the top bar, the table dock, or anything else that calls
// `setSettingsOpen(true)`. To add a group, add an entry to TABS and a panel for it below.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import { setTheme, THEMES, useTheme } from "../theme";
import { setSoundPack, SOUND_PACKS, useSoundPack, type PackId } from "../soundPacks";
import { loadPack, setEffectsVolume, setMuted, sfx, useMuted } from "../sfx";
import { pauseMusic, playMusic, setMusicMuted, setMusicVolume, useMusic } from "../music";
import { setMasterVolume, useVolumes } from "../volume";
import type { IconName } from "../icons";
import { Icon } from "./Icon";

const TABS: { id: "appearance" | "sound"; label: string; icon: IconName }[] = [
  { id: "appearance", label: "Appearance", icon: "sparkle" },
  { id: "sound", label: "Sound", icon: "volume" },
];
type TabId = (typeof TABS)[number]["id"];

/** The gear that opens Settings. */
export function SettingsButton() {
  const setOpen = useStore((s) => s.setSettingsOpen);
  return (
    <button className="btn ghost small icon-only" title="Settings" aria-label="Settings" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Icon name="gear" />
    </button>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const close = useStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<TabId>("appearance");
  const titleId = useId();
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus moves into the dialog on open and back to whatever had it on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    document.getElementById(`${baseId}-tab-appearance`)?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, [baseId]);

  // Esc closes (capture phase, so the table doesn't also clear its selection behind us).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  // Tab cycles within the dialog instead of wandering into the page (and the music bar) behind it.
  const trapTab = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, [href], select, textarea, [tabindex]")].filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const onTabKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length].id;
    setTab(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  };

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal panel settings" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapTab}>
        <header className="settings-head">
          <h2 id={titleId}>Settings</h2>
          <button className="btn ghost small icon-only" onClick={() => close(false)} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </header>
        <div className="settings-body">
          <div className="settings-tabs" role="tablist" aria-label="Settings" aria-orientation="vertical" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`${baseId}-tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`${baseId}-panel`}
                tabIndex={tab === t.id ? 0 : -1}
                className="settings-tab"
                onClick={() => setTab(t.id)}
              >
                <Icon name={t.icon} /> {t.label}
              </button>
            ))}
          </div>
          <div className="settings-panel scroll" id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`}>
            {tab === "appearance" ? <AppearanceTab /> : <SoundTab />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AppearanceTab() {
  const theme = useTheme();
  return (
    <section>
      <h3 className="settings-h">Theme</h3>
      <p className="faint settings-note">
        The look of the menus and table HUD. <kbd>Alt+Shift+T</kbd> cycles through them.
      </p>
      <div className="settings-options" role="group" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t.id} type="button" className="settings-option" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
            <span className={`theme-swatch t-${t.id}`} aria-hidden />
            <b>{t.label}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

/** A labelled volume slider with its percentage, and (when it has one) a speaker button that mutes just that channel. */
function VolumeRow({ label, value, onChange, onCommit, muted, onMute }: { label: string; value: number; onChange: (v: number) => void; onCommit?: () => void; muted?: boolean; onMute?: (m: boolean) => void }) {
  const shown = muted ? 0 : value;
  return (
    <div className="settings-volume">
      <span className="settings-volume-label">{label}</span>
      {onMute ? (
        <button type="button" className="btn ghost small icon-only" onClick={() => onMute(!muted)} aria-label={muted ? `Unmute ${label.toLowerCase()}` : `Mute ${label.toLowerCase()}`} aria-pressed={muted} title={muted ? "Unmute" : "Mute"}>
          <Icon name={muted || value === 0 ? "volume-off" : "volume"} />
        </button>
      ) : (
        <span className="settings-volume-icon" aria-hidden>
          <Icon name="volume" />
        </span>
      )}
      <input type="range" min={0} max={1} step={0.05} value={shown} aria-label={`${label} volume`} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} />
      <span className="settings-volume-pct faint">{Math.round(shown * 100)}%</span>
    </div>
  );
}

function SoundTab() {
  const muted = useMuted();
  const pack = useSoundPack();
  const music = useMusic();
  const vol = useVolumes();

  // Switching plays a short sample of the new pack, once its files have loaded.
  const choose = (p: PackId) => {
    setSoundPack(p);
    void loadPack(p).then(() => sfx.preview());
  };

  return (
    <>
      <section>
        <h3 className="settings-h">Volume</h3>
        <p className="faint settings-note">Master turns everything up or down at once; music and effects are balanced under it.</p>
        <VolumeRow label="Master" value={vol.master} onChange={setMasterVolume} />
        <VolumeRow label="Music" value={music.volume} onChange={setMusicVolume} muted={music.muted} onMute={setMusicMuted} />
        <VolumeRow label="Effects" value={vol.sfx} onChange={setEffectsVolume} onCommit={() => sfx.flip(0)} muted={muted} onMute={setMuted} />
      </section>
      <section className="settings-checks">
        <label className="field check">
          <input type="checkbox" checked={music.on} onChange={(e) => (e.target.checked ? playMusic() : pauseMusic())} />
          <span>Play background music</span>
        </label>
        <p className="faint settings-note">Tracks and playback controls are in the music player (the note in the bottom-right corner).</p>
      </section>
      <section>
        <h3 className="settings-h">Sound pack</h3>
        <p className="faint settings-note">{muted ? "Sound effects are muted. Unmute them to hear a pack when you pick it." : "Pick one to hear it."}</p>
        <div className="settings-options" role="group" aria-label="Sound pack">
          {SOUND_PACKS.map((p) => (
            <button key={p.id} type="button" className="settings-option" aria-pressed={pack === p.id} onClick={() => choose(p.id)}>
              <b>{p.label}</b>
              <span className="faint">{p.blurb}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
