// /dev/sound-studio: audition the sound packs. Play the draft's sound sequences with the game's own
// timings, hear any sound from any pack, and mix packs per sound (see soundStudio.ts). Linked from
// the debug console; opens in its own tab.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { navigate } from "../router";
import { useStore } from "../store";
import { copyText } from "../clipboard";
import { isMuted, loadPack, onSfx, setMuted, setPackOverride, stopAll } from "../sfx";
import { SOUND_PACKS, useSoundPack, type PackId } from "../soundPacks";
import { CompanionVoices } from "./CompanionVoices";
import {
  basePack,
  browseCards,
  chain,
  createStudioPlayer,
  makePick,
  mixSummary,
  openPack,
  PACK_CONTENTS,
  packPreview,
  playOne,
  readMix,
  STUDIO_GROUPS,
  STUDIO_SOUNDS,
  uniformMix,
  type Mix,
  type PackContents,
  type Scheduler,
  type TearStyle,
} from "../soundStudio";

/** The prompt each sample was generated from, per pack (scripts/sfx/prompts/<pack>.json). */
const PROMPTS = Object.fromEntries(
  Object.entries(import.meta.glob<Record<string, string>>("../../../scripts/sfx/prompts/*.json", { eager: true, import: "default" })).map(([path, prompts]) => [
    path
      .split("/")
      .pop()!
      .replace(/\.json$/, ""),
    prompts,
  ]),
);

/** A swatch per pack, so the cue log and the table read at a glance. */
const PACK_COLORS: Record<string, string> = {
  tabletop: "#c9a15a",
  arcane: "#a58cff",
  library: "#d0745a",
  grove: "#7cc48f",
};
const packStyle = (id: PackId) => ({ "--c": PACK_COLORS[id] ?? "var(--gold)" }) as CSSProperties;
const packLabel = (id: PackId) => SOUND_PACKS.find((p) => p.id === id)?.label ?? id;

const MIX_KEY = "hd.soundStudio.mix";
const CONTENTS_KEY = "hd.soundStudio.contents";
const TABS = { packs: "Sound packs", companions: "Companions" } as const;
type TabId = keyof typeof TABS;
const SEQUENCES = {
  open: "Open a pack",
  pick: "Make a pick",
  browse: "Browse cards",
  turn: "Whole turn",
  preview: "Debug preview",
} as const;
type SequenceId = keyof typeof SEQUENCES;

interface Cue {
  id: number;
  /** Seconds since the sequence started (or since the single sound was clicked). */
  t: number;
  name: string;
  /** The pack it actually came from; null when nothing could play (the synth stood in). */
  pack: PackId | null;
}

function readStored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not remembered, still used */
  }
}

let cueIds = 0;

export function SoundStudio() {
  const toast = useStore((s) => s.toast);
  const inGame = useSoundPack();
  const [mix, setMix] = useState<Mix>(() => readMix(readStored(MIX_KEY), inGame));
  const [contents, setContents] = useState<PackContents>(() => {
    const saved = readStored(CONTENTS_KEY);
    return typeof saved === "string" && saved in PACK_CONTENTS ? (saved as PackContents) : "mythic";
  });
  const [tear, setTear] = useState<TearStyle>("drag");
  const [cues, setCues] = useState<Cue[]>([]);
  const [lit, setLit] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState<SequenceId | null>(null);
  const [muted, setMutedState] = useState(isMuted);
  const [shown, setShown] = useState<{ pack: PackId; name: string } | null>(null);
  const [tab, setTab] = useState<TabId>(() => (new URLSearchParams(location.search).get("tab") === "companions" ? "companions" : "packs"));

  const mixRef = useRef(mix);
  mixRef.current = mix;
  const [player] = useState(() =>
    createStudioPlayer({
      load: (packs) => Promise.all(packs.map(loadPack)),
      stopAudio: stopAll,
    }),
  );
  const startedAt = useRef(performance.now());
  const logRef = useRef<HTMLOListElement>(null);

  // While the studio is open, each sound plays from the pack the mix gives it.
  useEffect(() => {
    setPackOverride((name) => mixRef.current[name]);
    return () => setPackOverride(null);
  }, []);
  useEffect(() => store(MIX_KEY, mix), [mix]);
  useEffect(() => store(CONTENTS_KEY, contents), [contents]);

  useEffect(
    () =>
      onSfx(({ name, pack }) => {
        const t = (performance.now() - startedAt.current) / 1000;
        setCues((cs) => [...cs.slice(-79), { id: ++cueIds, t, name, pack }]);
        if (!pack) return;
        const key = `${pack}/${name}`;
        setLit((s) => new Set(s).add(key));
        window.setTimeout(
          () =>
            setLit((s) => {
              const next = new Set(s);
              next.delete(key);
              return next;
            }),
          260,
        );
      }),
    [],
  );
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [cues]);

  const stop = () => {
    player.stop();
    setLoading(null);
  };
  // Leaving the studio cancels everything, including a sequence still loading its packs.
  useEffect(() => () => player.stop(), [player]);

  /** Loads every pack the mix uses (first time only), then starts from a clean log. */
  const start = async (build: (s: Scheduler) => unknown, packs: PackId[], seq: SequenceId | null) => {
    if (seq) setLoading(seq);
    try {
      await player.start(build, packs, () => {
        if (seq) setCues([]);
        startedAt.current = performance.now();
      });
    } finally {
      if (seq) setLoading((cur) => (cur === seq ? null : cur));
    }
  };

  const sequence = (seq: SequenceId) => {
    const build: Record<SequenceId, (s: Scheduler) => unknown> = {
      open: (s) => openPack(s, contents, tear),
      pick: makePick,
      browse: browseCards,
      turn: (s) => chain(s, (x) => openPack(x, contents, tear), makePick, browseCards),
      preview: packPreview,
    };
    void start(build[seq], Object.values(mixRef.current), seq);
  };

  const audition = (pack: PackId, name: string) => {
    setMix((m) => ({ ...m, [name]: pack }));
    mixRef.current = { ...mixRef.current, [name]: pack };
    setShown({ pack, name });
    void start((s) => playOne(s, name), [pack], null);
  };

  const choosePack = (pack: PackId) => setMix(uniformMix(pack));

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };

  const copyMix = async () => {
    const text = mixSummary(mix);
    toast((await copyText(text)) ? "Mix copied" : text);
  };

  // Space opens a pack, P picks, B browses, Esc stops, 1–9 picks a whole pack.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || tab !== "packs") return;
      const k = e.key.toLowerCase();
      if (k === " " && !el.closest("button")) {
        e.preventDefault();
        sequence("open");
      } else if (k === "p") sequence("pick");
      else if (k === "b") sequence("browse");
      else if (k === "escape") stop();
      else if (/^[1-9]$/.test(k) && SOUND_PACKS[+k - 1]) choosePack(SOUND_PACKS[+k - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const base = basePack(mix);

  return (
    <div className="screen sound-studio">
      <header className="topbar">
        <span className="brand" role="link" style={{ cursor: "pointer" }} onClick={() => navigate("/")} title="Home">
          HyperDraft
        </span>
        <span className="topbar-sep" />
        <span className="topbar-title">Sound Studio</span>
        <div className="spacer" />
        <button className={`btn small${muted ? " danger" : ""}`} onClick={toggleMute} aria-pressed={muted}>
          <Icon name={muted ? "volume-off" : "volume"} />
          {muted ? "Muted" : "Sound on"}
        </button>
      </header>

      <main className="scroll ss-scroll">
        <div className="ss-page">
          <section className="ss-intro">
            <h1>Sound Studio</h1>
            <p className="ss-flavor">
              {tab === "packs" ? "Every sound of every pack, played with the draft's own timings and mix." : "Every companion's voice, slot by slot, with what it says."}
            </p>
            <p className="muted">
              {tab === "packs"
                ? "Play a sequence, then click any cell in the table to hear that sound and use it in your mix. Each row can come from a different pack. The mix only applies here; in the game each player picks one whole pack."
                : "Companion voices aren't part of the packs: a companion sounds the same whichever pack you play. Pick a companion, then play any slot or take; the colour variant shifts the pitch the way two copies at one table would."}
            </p>
            {muted && (
              <p className="pill warn ss-muted">
                Sound is muted (the game's mute applies here too).
                <button className="btn small" onClick={toggleMute}>
                  Unmute
                </button>
              </p>
            )}
          </section>

          <div className="ss-seg" role="tablist" aria-label="What to audition">
            {(Object.keys(TABS) as TabId[]).map((id) => (
              <button key={id} role="tab" className={`btn${tab === id ? " on" : ""}`} aria-selected={tab === id} onClick={() => setTab(id)}>
                {TABS[id]}
              </button>
            ))}
          </div>

          {tab === "companions" && <CompanionVoices />}

          {tab === "packs" && (
            <>
              <section className="ss-section" aria-labelledby="ss-packs">
                <div className="ss-head">
                  <h2 id="ss-packs">Packs</h2>
                  <span className="faint">
                    Pick one to use it for every sound · <kbd>1</kbd>–<kbd>{SOUND_PACKS.length}</kbd>
                  </span>
                </div>
                <div className="ss-packs">
                  {SOUND_PACKS.map((p, i) => {
                    const used = STUDIO_SOUNDS.filter((n) => mix[n] === p.id).length;
                    const state = used === STUDIO_SOUNDS.length ? " on" : used ? " part" : "";
                    return (
                      <button key={p.id} className={`ss-pack${state}`} style={packStyle(p.id)} onClick={() => choosePack(p.id)} aria-pressed={used === STUDIO_SOUNDS.length}>
                        <span className="ss-pack-name">
                          <span className="ss-dot" />
                          {p.label}
                          <kbd>{i + 1}</kbd>
                        </span>
                        <span className="ss-pack-blurb">{p.blurb}</span>
                        <span className="ss-pack-meta">
                          {used > 0 && used < STUDIO_SOUNDS.length && <span className="faint">{used === 1 ? "1 sound" : `${used} sounds`} in mix</span>}
                          {p.id === inGame && <span className="pill">In game</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="ss-transport">
                <div className="panel ss-panel">
                  <h2>Play a sequence</h2>
                  <div className="ss-seqs">
                    {(Object.keys(SEQUENCES) as SequenceId[]).map((id) => (
                      <button key={id} className={`btn${id === "open" ? " primary" : ""}`} disabled={loading !== null} onClick={() => sequence(id)}>
                        {id === "open" && <Icon name="play" />}
                        {loading === id ? "Loading…" : SEQUENCES[id]}
                      </button>
                    ))}
                    <button className="btn" onClick={stop}>
                      <Icon name="x" />
                      Stop
                    </button>
                  </div>
                  <div className="ss-opts">
                    <div>
                      <span className="label">Pack contents</span>
                      <div className="ss-seg" role="group" aria-label="Pack contents">
                        {(Object.keys(PACK_CONTENTS) as PackContents[]).map((k) => (
                          <button key={k} className={`btn small${contents === k ? " on" : ""}`} aria-pressed={contents === k} onClick={() => setContents(k)}>
                            {PACK_CONTENTS[k].label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="label">Tear</span>
                      <div className="ss-seg" role="group" aria-label="Tear">
                        {(["drag", "click"] as const).map((t) => (
                          <button key={t} className={`btn small${tear === t ? " on" : ""}`} aria-pressed={tear === t} onClick={() => setTear(t)}>
                            {t === "drag" ? "Drag (looping rip)" : "Click / Space"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="faint ss-hint">
                    <kbd>Space</kbd> open a pack · <kbd>P</kbd> make a pick · <kbd>B</kbd> browse · <kbd>Esc</kbd> stop. A pick is select, select, deselect, select, confirm (pick,
                    pass and a burn), the next pack arriving and three timer ticks. Browsing is zooming in, turning a double-faced card over, zooming out, hovering the picks list
                    and tapping.
                  </p>
                </div>

                <div className="panel ss-panel">
                  <div className="ss-head">
                    <h2>Cue log</h2>
                    <span className="label">{cues.length ? `${cues[cues.length - 1].t.toFixed(2)} s` : "0.00 s"}</span>
                  </div>
                  <ol className="ss-log scroll" ref={logRef}>
                    {cues.length === 0 && (
                      <li className="ss-log-empty faint">Sounds show up here as they play, with the time since the sequence started and the pack each came from.</li>
                    )}
                    {cues.map((c) => (
                      <li key={c.id}>
                        <span className="ss-t">{c.t.toFixed(2)}</span>
                        <span>{c.name}</span>
                        {c.pack ? (
                          <span className="ss-who" style={packStyle(c.pack)}>
                            <span className="ss-dot" />
                            {packLabel(c.pack)}
                          </span>
                        ) : (
                          <span className="ss-who faint">synth (not loaded)</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              </section>

              <section className="ss-section" aria-labelledby="ss-matrix">
                <div className="ss-head">
                  <h2 id="ss-matrix">Every sound, every pack</h2>
                  <span className="faint">Hover a cell for its ElevenLabs prompt. Filled cells are in your mix.</span>
                </div>
                <div className="panel ss-table-wrap scroll">
                  <table className="ss-table">
                    <thead>
                      <tr>
                        <th scope="col">Sound</th>
                        {SOUND_PACKS.map((p) => (
                          <th key={p.id} scope="col" style={packStyle(p.id)}>
                            <span className="ss-col">
                              <span className="ss-dot" />
                              {p.label}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    {STUDIO_GROUPS.map((g) => (
                      <tbody key={g.title}>
                        <tr className="ss-group">
                          <th colSpan={SOUND_PACKS.length + 1} scope="rowgroup">
                            {g.title}
                          </th>
                        </tr>
                        {g.sounds.map((s) => (
                          <tr key={s.name}>
                            <th scope="row" className={SOUND_PACKS.some((p) => lit.has(`${p.id}/${s.name}`)) ? "lit" : ""}>
                              <code>{s.name}</code>
                              <span className="faint">{s.what}</span>
                            </th>
                            {SOUND_PACKS.map((p) => (
                              <td key={p.id}>
                                <button
                                  className={`ss-cell${mix[s.name] === p.id ? " on" : ""}${lit.has(`${p.id}/${s.name}`) ? " lit" : ""}`}
                                  style={packStyle(p.id)}
                                  title={`${p.label} · ${s.name}\n\n${PROMPTS[p.id]?.[s.name] ?? ""}`}
                                  aria-label={`Play ${s.name} from ${p.label} and use it in the mix`}
                                  aria-pressed={mix[s.name] === p.id}
                                  onClick={() => audition(p.id, s.name)}
                                >
                                  <Icon name="play" />
                                </button>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              </section>

              <section className="ss-mix">
                <div className="panel ss-panel">
                  <h2>Your mix</h2>
                  <pre className="ss-summary">{mixSummary(mix)}</pre>
                  <div className="row">
                    <button className="btn small" onClick={copyMix}>
                      <Icon name="copy" />
                      Copy mix
                    </button>
                    <button className="btn small ghost" onClick={() => choosePack(base)}>
                      Reset to {packLabel(base)}
                    </button>
                  </div>
                </div>
                <div className="panel ss-panel">
                  <h2>Prompt</h2>
                  {shown ? (
                    <div className="ss-prompt">
                      <span className="ss-who" style={packStyle(shown.pack)}>
                        <span className="ss-dot" />
                        {packLabel(shown.pack)} / {shown.name}
                      </span>
                      <p>{PROMPTS[shown.pack]?.[shown.name] ?? "No prompt on file."}</p>
                      <code className="faint">
                        node scripts/build-sfx.mjs {shown.pack} {shown.name}
                      </code>
                    </div>
                  ) : (
                    <p className="faint">Click a cell to see the prompt that made it, and the command that regenerates it.</p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
