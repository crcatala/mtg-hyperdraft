// The Sound Studio's Companions tab, laid out like a console game's character screen: the roster down the left,
// the chosen companion on a stage (it hops and speaks its bubble as each sound plays), and a soundboard of its
// 16 voice slots underneath. Built for auditing: play any slot or take, flip the colour variant (picture and
// pitch change together), run the whole voice as a reel, or sweep one slot across every variant. Voices aren't
// part of the sound packs (companionVoice.ts), so nothing here depends on the pack.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { COMPANIONS, companionArt, companionDef, companionSmall } from "../roster";
import { variantColor, variantHue } from "../../shared/roster";
import { VOICE_SLOT_IDS, VOICE_SLOTS, voiceSlotLabel, voiceSlotLine } from "../../shared/companionKit";
import { variantPitch } from "../sfxMath";
import { loadVoice, playVoice, takeCount, type Voice } from "../companionVoice";
import { isMuted, stopAll } from "../sfx";

/** Hue variants worth trying: the original and the first three that tables hand out. */
const VARIANTS = [0, 1, 2, 3];

/** The soundboard's groups, in the order the game uses them. */
const GROUPS: { title: string; hint: string; slots: string[] }[] = [
  { title: "Lobby", hint: "Heard in character select", slots: ["hello"] },
  { title: "Poke ladder", hint: "Each tap climbs a step; the finale is followed by a sulk", slots: VOICE_SLOT_IDS.filter((s) => /^poke\d$/.test(s)) },
  { title: "Carrying", hint: "Picked up and put down", slots: ["pickup", "drop"] },
  { title: "Emote wheel", hint: "Cheer, love, oops, silly, sass, taunt", slots: VOICE_SLOT_IDS.filter((s) => /^emote\d$/.test(s)) },
];

const filled = (id: string) => VOICE_SLOT_IDS.filter((s) => takeCount(id, s) > 0).length;
const semitones = (v: number) => 12 * Math.log2(variantPitch(v));
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(1);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** What is sounding right now (or just did): drives the stage's bubble, hop and progress bar. */
interface Now {
  n: number;
  slot: string;
  seconds: number;
}

/** The sound that is sounding this moment (cleared when it ends or is stopped): drives the lit pad and the progress bar. */
interface Playing {
  n: number;
  slot: string;
  seconds: number;
}

export function CompanionVoices() {
  const [id, setId] = useState<string>(() => {
    const asked = new URLSearchParams(location.search).get("companion");
    return companionDef(asked ?? undefined)?.id ?? COMPANIONS.find((c) => filled(c.id) > 0)?.id ?? COMPANIONS[0].id;
  });
  const [variant, setVariant] = useState(0);
  const [now, setNow] = useState<Now | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  /** The slot the reel or the sweep is on, or the last one played by hand. */
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reel" | "sweep" | null>(null);
  const voice = useRef<Voice | null>(null);
  /** Bumped by anything that cancels a running reel/sweep or an older play request. */
  const run = useRef(0);
  const hops = useRef(0);
  const def = companionDef(id)!;
  const present = filled(id);
  const color = def.color;

  // Fetch the voice as soon as it's picked (it waits for the first click, which unlocks audio).
  useEffect(() => void loadVoice(id), [id]);

  const stop = useCallback(() => {
    run.current++;
    voice.current?.stop();
    voice.current = null;
    stopAll();
    setPlaying(null);
    setBusy(null);
  }, []);
  useEffect(() => stop, [stop]);

  /** Plays one slot (and take) at a pitch; resolves when it has finished sounding, or at once if it made no sound. */
  const play = useCallback(
    async (s: string, take: number | undefined, v: number, mine: number): Promise<void> => {
      // Muted clicks do nothing, rather than sounding later when the voice finishes loading after an unmute.
      if (isMuted()) return;
      await loadVoice(id);
      if (mine !== run.current || isMuted()) return;
      voice.current?.stop();
      const sounding = playVoice(id, s, { variant: v, take });
      voice.current = sounding;
      setSlot(s);
      const n = ++hops.current;
      setNow({ n, slot: s, seconds: sounding?.seconds ?? 0 });
      if (!sounding) return;
      setPlaying({ n, slot: s, seconds: sounding.seconds });
      await sleep(sounding.seconds * 1000);
      setPlaying((p) => (p?.n === n ? null : p));
    },
    [id],
  );

  const playOne = (s: string, take?: number) => {
    stop();
    void play(s, take, variant, run.current);
  };

  /** Every slot in order, as the game would use them: the whole voice in one pass. */
  const reel = async () => {
    stop();
    const mine = run.current;
    setBusy("reel");
    for (const s of VOICE_SLOT_IDS) {
      if (takeCount(id, s) === 0) continue;
      await play(s, undefined, variant, mine);
      if (mine !== run.current) return;
      await sleep(380);
      if (mine !== run.current) return;
    }
    setBusy(null);
  };

  /** One slot at each variant in turn: the picture's colour and the pitch change together. */
  const sweep = async () => {
    const s = slot && takeCount(id, slot) > 0 ? slot : VOICE_SLOT_IDS.find((x) => takeCount(id, x) > 0);
    if (!s) return;
    stop();
    const mine = run.current;
    setBusy("sweep");
    for (const v of VARIANTS) {
      setVariant(v);
      await play(s, undefined, v, mine);
      if (mine !== run.current) return;
      await sleep(320);
      if (mine !== run.current) return;
    }
    setBusy(null);
  };

  const pick = (next: string) => {
    if (next === id) return;
    stop();
    setId(next);
    setNow(null);
    setSlot(null);
  };

  // Up/Down walks the roster, 1-4 flips the variant, Esc stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const i = COMPANIONS.findIndex((c) => c.id === id);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        pick(COMPANIONS[(i + (e.key === "ArrowDown" ? 1 : -1) + COMPANIONS.length) % COMPANIONS.length].id);
      } else if (/^[1-4]$/.test(e.key)) setVariant(+e.key - 1);
      else if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const saying = now ? voiceSlotLine(id, now.slot) : undefined;
  const stage = { "--c": variantColor(color, variant) } as CSSProperties;
  const groups = useMemo(() => GROUPS, []);

  return (
    <div className="cv">
      <aside className="panel cv-roster" aria-label="Companions">
        <header className="cv-panel-head">
          <h2>Companions</h2>
          <span className="faint">
            <kbd>↑</kbd> <kbd>↓</kbd>
          </span>
        </header>
        <ul className="cv-roster-list scroll">
          {COMPANIONS.map((c) => {
            const n = filled(c.id);
            return (
              <li key={c.id}>
                <button className={`cv-who${c.id === id ? " on" : ""}${n === 0 ? " empty" : ""}`} style={{ "--c": c.color } as CSSProperties} aria-pressed={c.id === id} onClick={() => pick(c.id)}>
                  <img src={companionSmall(c.id)} alt="" draggable={false} />
                  <span className="cv-who-text">
                    <b>{c.name}</b>
                    <span className="faint">{c.species}</span>
                    <span className="cv-meter" title={n === 0 ? "No voice yet" : `${n} of ${VOICE_SLOT_IDS.length} slots`}>
                      {VOICE_SLOT_IDS.map((s) => (
                        <i key={s} className={takeCount(c.id, s) > 0 ? "on" : ""} />
                      ))}
                    </span>
                  </span>
                  <span className="cv-count">{n === 0 ? "—" : `${n}/${VOICE_SLOT_IDS.length}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="cv-main" aria-label={`${def.name}'s voice`}>
        <div className="panel cv-stage" style={stage}>
          <div className="cv-art">
            <div className="cv-glow" />
            <img
              key={def.id}
              className={now ? (now.n % 2 ? "hop-a" : "hop-b") : undefined}
              src={companionArt(def.id)}
              alt={def.name}
              draggable={false}
              style={{ filter: `hue-rotate(${variantHue(variant)}deg) drop-shadow(0 10px 14px rgb(0 0 0 / 0.5))` }}
              onClick={() => {
                const first = VOICE_SLOT_IDS.find((s) => /^poke/.test(s) && takeCount(id, s) > 0);
                if (first) playOne(first);
              }}
            />
            <div className="cv-bubble-wrap" aria-live="polite">
              {now && (
                <div key={now.n} className={`cv-bubble${saying ? "" : " quiet"}`}>
                  {saying ? <>“{saying}”</> : now.seconds > 0 ? <i>{voiceSlotLabel(now.slot)}</i> : <i>(no sound)</i>}
                </div>
              )}
            </div>
          </div>

          <div className="cv-info">
            <div className="cv-title">
              <span className="faint">{def.species}</span>
              <h2>{def.name}</h2>
              <p className="faint">{def.personality}</p>
            </div>

            <div className="cv-block">
              <span className="label">Colour variant · pitch</span>
              <div className="cv-variants" role="group" aria-label="Colour variant">
                {VARIANTS.map((v) => (
                  <button
                    key={v}
                    className={`cv-variant${variant === v ? " on" : ""}`}
                    style={{ "--v": variantColor(color, v) } as CSSProperties}
                    aria-pressed={variant === v}
                    onClick={() => setVariant(v)}
                    title={`Rate ×${variantPitch(v).toFixed(3)}`}
                  >
                    <i className="cv-swatch" />
                    <b>{v === 0 ? "Original" : `#${v}`}</b>
                    <span>{v === 0 ? "1.00×" : `${signed(semitones(v))} st`}</span>
                    <kbd>{v + 1}</kbd>
                  </button>
                ))}
              </div>
            </div>

            <div className="cv-actions">
              <button className="btn primary" disabled={present === 0} onClick={() => (busy === "reel" ? stop() : void reel())}>
                <Icon name={busy === "reel" ? "x" : "play"} />
                {busy === "reel" ? "Stop reel" : "Play the whole voice"}
              </button>
              <button className="btn" disabled={present === 0} onClick={() => (busy === "sweep" ? stop() : void sweep())} title="Plays the selected slot at every variant, one after another">
                <Icon name={busy === "sweep" ? "x" : "play"} />
                {busy === "sweep" ? "Stop sweep" : `Sweep variants${slot ? ` · ${slot}` : ""}`}
              </button>
              <button className="btn ghost" onClick={stop}>
                <Icon name="x" /> Stop <kbd>Esc</kbd>
              </button>
            </div>

            <div className={`cv-now${playing ? " live" : ""}`} aria-hidden>
              {playing && <i key={playing.n} style={{ animationDuration: `${playing.seconds}s` }} />}
            </div>
          </div>
        </div>

        <div className="panel cv-board">
          <header className="cv-panel-head">
            <h2>{def.name}'s soundboard</h2>
            <span className="faint">{present === 0 ? "no voice files yet · scripts/build-companion-sfx.mjs" : `${present} of ${VOICE_SLOT_IDS.length} slots · click a pad to play it, the numbers play a specific take`}</span>
          </header>
          <div className="cv-board-scroll scroll">
            {groups.map((g) => (
              <section key={g.title} className="cv-group">
                <h3>
                  {g.title} <span className="faint">{g.hint}</span>
                </h3>
                <div className="cv-pads">
                  {g.slots.map((s) => {
                    const n = takeCount(id, s);
                    const line = voiceSlotLine(id, s);
                    const live = playing?.slot === s;
                    return (
                      <div key={s} className={`cv-pad${n === 0 ? " missing" : ""}${slot === s ? " sel" : ""}${live ? " live" : ""}`} title={VOICE_SLOTS[s]?.emotion}>
                        <button className="cv-pad-main" disabled={n === 0} onClick={() => playOne(s)} aria-label={`Play ${voiceSlotLabel(s)}`}>
                          <span className="cv-pad-top">
                            <code>{s}</code>
                            <span className="faint">{voiceSlotLabel(s).replace(/^Emote · |^Poke \d · /, "")}</span>
                          </span>
                          <span className="cv-pad-line">{line ? <>“{line}”</> : <span className="faint">{s === "hello" ? "(a greeting, no bubble)" : "—"}</span>}</span>
                        </button>
                        <span className="cv-pad-foot">
                          {n === 0 ? (
                            <span className="pill warn">missing</span>
                          ) : (
                            <>
                              <Icon name="play" />
                              {n > 1 ? (
                                Array.from({ length: n }, (_, i) => (
                                  <button key={i} className="cv-take" onClick={() => playOne(s, i)} aria-label={`Play take ${i + 1} of ${s}`}>
                                    {i + 1}
                                  </button>
                                ))
                              ) : (
                                <span className="faint">1 take</span>
                              )}
                            </>
                          )}
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
  );
}
