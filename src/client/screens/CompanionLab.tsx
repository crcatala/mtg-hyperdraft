// /dev/companion-lab: review every companion's 18 reactions on the real table figure (CompanionFigure), on a
// plain stage. Pick a companion and a colour variant, press a reaction to play it (with its voice, if it has
// one, and its line in a bubble), slow time down to look closely, interrupt one reaction with another to check
// the blend, or put four companions on stage at once to check that glyphs stay bounded and the frame rate holds.
// Linked from the debug console; opens in its own tab.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Icon } from "../components/Icon";
import { navigate } from "../router";
import { COMPANIONS, companionDef, companionSmall } from "../roster";
import { variantColor } from "../../shared/roster";
import { emoteSound, EMOTE_SLOTS, REACTION_IDS, VOICE_SLOT_IDS, voiceSlotLabel, voiceSlotLine } from "../../shared/companionKit";
import { CompanionFigure } from "../table/CompanionFigure";
import { SpeechBubbles } from "../table/SpeechBubbles";
import { reactionSeconds } from "../table/companionMotion";
import { bodyStyle, reactionFor, SIGNATURES } from "../table/companionReactions";
import { playReaction, reactionNow, setReactionTimeScale, stopReaction } from "../table/companionPlayback";
import { reducedMotion } from "../table/motion";
import { say } from "../table/companionTalk";
import { emoteBadge } from "../table/emoteWheel";
import { loadVoice, playVoice, type Voice } from "../companionVoice";
import { isMuted, setMuted, stopAll } from "../sfx";
import { useCompanionPrefs } from "../companionPrefs";

/** The lab's figures react as these "players" (one per stage spot). */
const LAB_IDS = ["lab-0", "lab-1", "lab-2", "lab-3"];
const SPEEDS = [1, 0.5, 0.25] as const;
const MAX_VARIANT = 7;

const GROUPS: { title: string; hint: string; slots: string[] }[] = [
  { title: "Lobby", hint: "Says hello in character select", slots: ["hello"] },
  { title: "Poke ladder", hint: "Each tap climbs a step; the finale is followed by a sulk", slots: [...REACTION_IDS.filter((s) => /^poke\d$/.test(s)), "sulk"] },
  { title: "Carrying", hint: "Picked up, carried (loops until dropped), put down", slots: ["pickup", "carry", "drop"] },
  { title: "Emote wheel", hint: "Cheer, love, oops, silly, sass, taunt", slots: REACTION_IDS.filter((s) => /^emote\d$/.test(s)) },
];

const slotLabel = (slot: string) => (slot === "sulk" ? "Sulk (after the finale)" : slot === "carry" ? "Carry (loop)" : voiceSlotLabel(slot));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Waits `ms` on the reactions' clock (so slow motion stretches it), or until `still()` turns false. */
async function wait(ms: number, still: () => boolean) {
  const until = reactionNow() + ms;
  while (still() && reactionNow() < until) await sleep(30);
}

/** What was last played, for the caption under the stage. */
interface Shown {
  n: number;
  slot: string;
}

export function CompanionLab() {
  const [id, setId] = useState<string>(() => companionDef(new URLSearchParams(location.search).get("companion") ?? undefined)?.id ?? COMPANIONS[0].id);
  const [variant, setVariant] = useState(0);
  const [four, setFour] = useState(() => new URLSearchParams(location.search).get("stage") === "four");
  const [speed, setSpeed] = useState<number>(1);
  const [sound, setSound] = useState(() => !isMuted());
  const [shown, setShown] = useState<Shown | null>(null);
  const speech = useCompanionPrefs().speech;
  const [reeling, setReeling] = useState(false);
  const run = useRef(0);
  const voices = useRef<Voice[]>([]);
  const def = companionDef(id)!;
  const style = bodyStyle(id);
  const cast = four ? [id, ...COMPANIONS.map((c) => c.id).filter((c) => c !== id)].slice(0, 4) : [id];

  useEffect(() => {
    for (const c of cast) void loadVoice(c);
  }, [cast.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setReactionTimeScale(speed), [speed]);
  useEffect(() => () => setReactionTimeScale(1), []);

  const hush = () => {
    voices.current.forEach((v) => v.stop());
    voices.current = [];
  };

  /** Plays a reaction on everyone on stage, with each one's voice for that slot (at real speed only: slowed audio would be misleading). */
  const play = (slot: string) => {
    hush();
    cast.forEach((c, i) => {
      playReaction(LAB_IDS[i], slot);
      // Only the selected one speaks: four bubbles side by side would cover each other on this small stage.
      if (i === 0) {
        const emote = EMOTE_SLOTS.findIndex((_, e) => emoteSound(e) === slot);
        say(LAB_IDS[i], voiceSlotLine(c, slot), emote >= 0 ? "large" : "small", emote >= 0 ? emoteBadge(emote) : undefined);
      }
      if (sound && speed === 1 && VOICE_SLOT_IDS.includes(slot)) {
        const v = playVoice(c, slot, { variant: i === 0 ? variant : 0, gain: i === 0 ? 1 : 0.35 });
        if (v) voices.current.push(v);
      }
    });
    setShown((s) => ({ n: (s?.n ?? 0) + 1, slot }));
  };

  /** Cancels whatever reel or interrupt test is running (and with it the reel's Stop button); returns the new run's number. */
  const cancel = () => {
    setReeling(false);
    return ++run.current;
  };

  const stop = () => {
    cancel();
    hush();
    stopAll();
    LAB_IDS.forEach(stopReaction);
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every reaction in order, each given its full length (the carry loop gets two rounds). */
  const reel = async () => {
    const mine = cancel();
    setReeling(true);
    for (const g of GROUPS)
      for (const slot of g.slots) {
        if (run.current !== mine) return;
        play(slot);
        const r = reactionFor(id, slot)!;
        await wait(reactionSeconds(r, style) * (r.loop ? 2 : 1) * 1000 + 350, () => run.current === mine);
        if (r.loop && run.current === mine) LAB_IDS.forEach(stopReaction);
      }
    if (run.current === mine) setReeling(false);
  };

  /** The finale, cut off part-way by an affectionate poke, then the cheer cut off by a pick-up: should blend, never pop. */
  const interrupt = async () => {
    const mine = cancel();
    for (const [slot, after] of [["poke7", 450], ["poke3", 600], ["emote1", 350], ["pickup", 0]] as const) {
      if (run.current !== mine) return;
      play(slot);
      await wait(after, () => run.current === mine);
    }
  };

  const pick = (next: string) => {
    stop();
    setId(next);
    const url = new URL(location.href);
    url.searchParams.set("companion", next);
    history.replaceState(null, "", url);
  };

  const toggleSound = () => {
    setMuted(sound);
    setSound(!sound);
  };

  // Keys: ↑/↓ companion, Esc stop, Space replays the last reaction.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      const i = COMPANIONS.findIndex((c) => c.id === id);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        pick(COMPANIONS[(i + (e.key === "ArrowDown" ? 1 : -1) + COMPANIONS.length) % COMPANIONS.length].id);
      } else if (e.key === "Escape") stop();
      else if (e.key === " " && shown && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        play(shown.slot);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const r = shown ? reactionFor(id, shown.slot) : undefined;
  const line = shown ? voiceSlotLine(id, shown.slot) : undefined;
  const sigs = SIGNATURES[id] ?? {};
  const color = variantColor(def.color, variant);

  return (
    <div className="screen sound-studio companion-lab">
      <header className="topbar">
        <span className="brand" role="link" style={{ cursor: "pointer" }} onClick={() => navigate("/")} title="Home">
          HyperDraft
        </span>
        <span className="topbar-sep" />
        <span className="topbar-title">Companion Lab</span>
        <div className="spacer" />
        <div className="cl-speeds" role="group" aria-label="Speed">
          {SPEEDS.map((k) => (
            <button key={k} className={`ss-tab${speed === k ? " on" : ""}`} aria-pressed={speed === k} onClick={() => setSpeed(k)} title={k === 1 ? "Real time" : "Slow motion (voices stay quiet)"}>
              {k === 1 ? "1×" : k === 0.5 ? "½×" : "¼×"}
            </button>
          ))}
        </div>
        <button className={`btn small${sound ? "" : " danger"}`} onClick={toggleSound} aria-pressed={!sound}>
          <Icon name={sound ? "volume" : "volume-off"} />
          {sound ? "Voices on" : "Muted"}
        </button>
        <a className="btn small ghost" href="/dev/sound-studio?tab=companions" target="_blank" rel="noreferrer">
          <Icon name="music" /> Voices
        </a>
      </header>

      <main className="ss-body">
        {reducedMotion() && <p className="pill warn ss-muted">Reduced motion is on: companions hold still and show one glyph per reaction (that's the intended behaviour).</p>}
        {!speech && <p className="pill warn ss-muted">Companion speech is off in Settings, so no bubbles here either (voices still play: the lab always plays them).</p>}
        <div className="cv">
          <aside className="panel cv-roster" aria-label="Companions">
            <header className="cv-panel-head">
              <h2>Companions</h2>
              <span className="faint">
                <kbd>↑</kbd> <kbd>↓</kbd>
              </span>
            </header>
            <ul className="cv-roster-list scroll">
              {COMPANIONS.map((c) => (
                <li key={c.id}>
                  <button className={`cv-who${c.id === id ? " on" : ""}`} style={{ "--c": c.color } as CSSProperties} aria-pressed={c.id === id} onClick={() => pick(c.id)}>
                    <img src={companionSmall(c.id)} alt="" draggable={false} />
                    <span className="cv-who-text">
                      <b>{c.name}</b>
                      <span className="faint">{c.species}</span>
                    </span>
                    <span className="cv-count" title="Signature reactions">
                      ★{Object.keys(SIGNATURES[c.id] ?? {}).length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="cv-main cl-main" aria-label={`${def.name}'s reactions`}>
            <div className="panel cl-stage" style={{ "--c": color } as CSSProperties}>
              <Canvas className="cl-canvas" dpr={[1, 2]} camera={{ fov: 34, near: 0.5, far: 200, position: [0, 4, 9] }} gl={{ antialias: true }}>
                <LabScene cast={cast} variant={variant} />
              </Canvas>
              <div className="cl-caption" aria-live="polite">
                {shown && r ? (
                  <>
                    <b>{slotLabel(shown.slot)}</b>
                    <span className={sigs[shown.slot] ? "cl-sig" : "faint"}>{sigs[shown.slot] ? `★ ${r.move}` : "shared default"}</span>
                    <span className="faint">
                      {reactionSeconds(r, style).toFixed(2)} s{r.loop ? " · loops" : ""}
                    </span>
                    {line && <i>“{line}”</i>}
                  </>
                ) : (
                  <span className="faint">Press a reaction below</span>
                )}
              </div>
              <Fps />
            </div>

            <div className="panel cl-controls">
              <div className="cl-who">
                <span className="faint">{def.species}</span>
                <h2>{def.name}</h2>
                <span className="cl-style" title="Body style: how its whole body moves (companionReactions.ts)">
                  bounce {style.bounce} · speed {style.speed} · sway {style.amp} · squash {style.squash}
                </span>
              </div>
              <label className="cl-variant">
                <span className="label">Variant {variant === 0 ? "· original" : `#${variant}`}</span>
                <input type="range" min={0} max={MAX_VARIANT} value={variant} onChange={(e) => setVariant(+e.target.value)} style={{ accentColor: color }} />
              </label>
              <div className="cl-actions">
                <button className={`btn small${four ? "" : " primary"}`} aria-pressed={!four} onClick={() => setFour(false)}>
                  One
                </button>
                <button className={`btn small${four ? " primary" : ""}`} aria-pressed={four} onClick={() => setFour(true)} title="Four companions react at once (glyph pool + frame rate check)">
                  Four at once
                </button>
                <span className="cl-gap" />
                <button className="btn small" onClick={() => (reeling ? stop() : void reel())}>
                  <Icon name={reeling ? "x" : "play"} />
                  {reeling ? "Stop" : "Play all 18"}
                </button>
                <button className="btn small" onClick={() => void interrupt()} title="Starts reactions over each other: each should blend out of the last, never pop">
                  <Icon name="sparkles" /> Interrupt test
                </button>
                <button className="btn small ghost" onClick={stop}>
                  <Icon name="x" /> Stop <kbd>Esc</kbd>
                </button>
              </div>
            </div>

            <div className="panel cv-board" style={{ "--c": color } as CSSProperties}>
              <header className="cv-panel-head">
                <h2>{def.name}'s reactions</h2>
                <span className="faint">★ = signature move · {def.moves.join(" · ")}</span>
              </header>
              <div className="cv-board-scroll scroll">
                {GROUPS.map((g) => (
                  <section key={g.title} className="cv-group">
                    <h3>
                      {g.title} <span className="faint">{g.hint}</span>
                    </h3>
                    <div className="cv-pads cl-pads">
                      {g.slots.map((s) => {
                        const rs = reactionFor(id, s)!;
                        const sig = sigs[s];
                        return (
                          <div key={s} className={`cv-pad${shown?.slot === s ? " sel" : ""}`}>
                            <button className="cv-pad-main" onClick={() => play(s)} aria-label={`Play ${slotLabel(s)}`}>
                              <span className="cv-pad-top">
                                <code>{s}</code>
                                <span className="faint">{slotLabel(s).replace(/^Emote · |^Poke \d · /, "")}</span>
                              </span>
                              <span className={sig ? "cl-sig" : "faint"}>{sig ? `★ ${rs.move}` : "shared default"}</span>
                            </button>
                            <span className="cv-pad-foot">
                              <Icon name="play" /> {reactionSeconds(rs, style).toFixed(2)} s{rs.loop ? " · loops" : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
      {/* Out here, not in the stage: a panel's backdrop-filter (the Arcane theme) would make it the bubbles' frame. */}
      <SpeechBubbles />
    </div>
  );
}

/** The plain stage: a floor disc and the cast, spaced across it; the camera looks down at them like a seat at the table does. */
function LabScene({ cast, variant }: { cast: string[]; variant: number }) {
  const { camera } = useThree();
  const n = cast.length;
  useEffect(() => {
    // Aimed above their heads, leaving room for speech bubbles.
    camera.position.set(0, n > 1 ? 6.5 : 3.6, n > 1 ? 15 : 7.6);
    camera.lookAt(0, 2.2, 0);
  }, [camera, n]);
  return (
    <>
      <color attach="background" args={["#0d0b16"]} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <circleGeometry args={[n > 1 ? 11 : 5, 64]} />
        <meshBasicMaterial color="#1b2333" />
      </mesh>
      {cast.map((c, i) => (
        <CompanionFigure key={`${i}:${c}`} playerId={LAB_IDS[i]} companion={c} variant={i === 0 ? variant : 0} at={{ x: (i - (n - 1) / 2) * 3.4, y: 0 }} active={false} turnNumber={0} offline={false} />
      ))}
    </>
  );
}

/** Frames per second over the last half second, and the worst frame, written straight into the DOM (no re-renders). */
function Fps() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frames = 0;
    let worst = 0;
    let last = performance.now();
    let since = last;
    let raf = requestAnimationFrame(function tick(now) {
      frames++;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - since >= 500) {
        if (ref.current) ref.current.textContent = `${Math.round((frames * 1000) / (now - since))} fps · worst frame ${worst.toFixed(0)} ms`;
        frames = 0;
        worst = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span className="cl-fps faint" ref={ref} />;
}
