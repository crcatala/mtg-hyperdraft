// The music player: a small pill in the bottom-right corner that expands into a slim bar along the
// bottom of the window (scrubber, previous / play / next, volume, a popup of the whole playlist). The
// bar takes its own strip: while it's open every screen ends above it (see `data-music-open` in
// screens.css) so it never covers the game. The music itself lives in music.ts and plays on across
// screens; this is only its remote control. Hidden on the /dev pages.

import { useEffect, useState } from "react";
import { usePath } from "../router";
import { useStore } from "../store";
import { formatTime, nextTrack, prevTrack, seekMusic, selectTrack, setMusicMuted, setMusicVolume, setPlayerOpen, toggleMusic, TRACKS, useMusic, useMusicClock } from "../music";
import { Icon } from "./Icon";

/** Three bars that bounce while the music plays. */
function Equalizer({ active }: { active: boolean }) {
  return (
    <span className={`music-eq${active ? " on" : ""}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function MusicPlayer() {
  const path = usePath();
  const open = useMusic().open;
  const hidden = path.startsWith("/dev/");
  const bar = open && !hidden;

  // Tells the stylesheet to make room for the bar.
  useEffect(() => {
    if (!bar) return;
    document.documentElement.dataset.musicOpen = "";
    return () => {
      delete document.documentElement.dataset.musicOpen;
    };
  }, [bar]);

  if (hidden) return null;
  return open ? <Bar /> : <Minimized />;
}

function PlayPause({ className = "" }: { className?: string }) {
  const { on, playing } = useMusic();
  const showPause = on && playing;
  return (
    <button className={`music-btn ${className}`} data-music-toggle onClick={toggleMusic} aria-label={showPause ? "Pause music" : "Play music"} title={showPause ? "Pause" : "Play"}>
      <Icon name={showPause ? "pause" : "play"} />
    </button>
  );
}

function Minimized() {
  const { index, playing } = useMusic();
  return (
    <div className="music-widget music-mini" role="group" aria-label="Music">
      <PlayPause />
      <button className="music-btn music-expand" onClick={() => setPlayerOpen(true)} aria-label="Open music player" aria-expanded={false} title={`Music: ${TRACKS[index].title}`}>
        <Icon name="music" />
        <Equalizer active={playing} />
      </button>
    </div>
  );
}

function Bar() {
  const { index, playing, volume, muted, failed } = useMusic();
  const openSettings = useStore((s) => s.setSettingsOpen);
  const [list, setList] = useState(false);

  // The playlist popup closes on a click anywhere else, or Esc (captured, so the table doesn't also clear its selection).
  useEffect(() => {
    if (!list) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".music-widget")) setList(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setList(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [list]);

  return (
    <section className="music-widget music-bar" aria-label="Music player">
      <div className="music-transport">
        <button className="music-btn" onClick={prevTrack} aria-label="Previous track" title="Previous (restarts if the track is under way)">
          <Icon name="prev" />
        </button>
        <PlayPause className="music-main" />
        <button className="music-btn" onClick={nextTrack} aria-label="Next track" title="Next">
          <Icon name="skip" />
        </button>
      </div>

      <div className="music-now">
        <Equalizer active={playing} />
        <div className="music-title" aria-live="polite">
          {failed ? "Couldn't load the music" : TRACKS[index].title}
        </div>
      </div>

      <Scrubber />

      <div className="music-volume">
        <button className="music-btn" onClick={() => setMusicMuted(!muted)} aria-label={muted ? "Unmute music" : "Mute music"} aria-pressed={muted} title={muted ? "Unmute music" : "Mute music"}>
          <Icon name={muted || volume === 0 ? "volume-off" : "volume"} />
        </button>
        <input type="range" className={muted ? "muted" : undefined} min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setMusicVolume(Number(e.target.value))} aria-label="Music volume" />
      </div>

      <div className="music-tools">
        <button className="btn ghost small music-list-btn" onClick={() => setList((v) => !v)} aria-expanded={list} aria-controls="music-tracks" aria-label="Track list">
          <span className="music-list-label">Tracks</span> <Icon name={list ? "chevron-down" : "chevron-up"} />
        </button>
        <button className="btn ghost small icon-only" onClick={() => openSettings(true)} aria-label="Sound settings" title="Sound settings">
          <Icon name="gear" />
        </button>
        <button className="btn ghost small icon-only" onClick={() => setPlayerOpen(false)} aria-label="Minimize music player" aria-expanded title="Minimize">
          <Icon name="chevron-down" />
        </button>
      </div>

      {list && (
        <ol className="music-tracks panel scroll" id="music-tracks" aria-label="Tracks">
          {TRACKS.map((t, i) => (
            <li key={t.id}>
              <button className={`music-track${i === index ? " current" : ""}`} onClick={() => selectTrack(i)} aria-current={i === index ? "true" : undefined}>
                <span className="music-track-no">{i === index ? <Equalizer active={playing} /> : i + 1}</span>
                <span className="music-track-title">{t.title}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Scrubber() {
  const { time, duration } = useMusicClock();
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  return (
    <div className="music-scrub">
      <span className="music-time">{formatTime(time)}</span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(time, duration || 1)}
        disabled={!duration}
        onChange={(e) => seekMusic(Number(e.target.value))}
        aria-label="Seek"
        aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
      />
      <span className="music-time">{formatTime(duration)}</span>
    </div>
  );
}
