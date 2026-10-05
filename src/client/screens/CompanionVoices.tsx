// The Sound Studio's Companions tab: every companion's voice, slot by slot. Pick a companion, play any take of
// any slot (optionally at a colour variant's pitch), read what it says, and see at a glance which sounds are
// still missing. Voices aren't part of the sound packs (companionVoice.ts), so nothing here depends on the pack.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { COMPANIONS, companionDef } from "../roster";
import { VOICE_SLOT_IDS, VOICE_SLOTS, voiceSlotLabel, voiceSlotLine } from "../../shared/companionKit";
import { variantPitch } from "../sfxMath";
import { loadVoice, playVoice, takeCount, type Voice } from "../companionVoice";
import { onSfx, stopAll } from "../sfx";

/** Hue variants worth trying: the original and the first three that tables hand out. */
const VARIANTS = [0, 1, 2, 3];

const filled = (id: string) => VOICE_SLOT_IDS.filter((s) => takeCount(id, s) > 0).length;

export function CompanionVoices() {
  const [id, setId] = useState<string>(() => {
    const asked = new URLSearchParams(location.search).get("companion");
    return companionDef(asked ?? undefined)?.id ?? COMPANIONS.find((c) => filled(c.id) > 0)?.id ?? COMPANIONS[0].id;
  });
  const [variant, setVariant] = useState(0);
  const [ready, setReady] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  const voice = useRef<Voice | null>(null);
  const def = companionDef(id)!;
  const present = filled(id);

  useEffect(() => {
    setReady(false);
    let current = true;
    void loadVoice(id).then(() => current && setReady(true));
    return () => {
      current = false;
    };
  }, [id]);

  // Light the row while its sound plays.
  useEffect(
    () =>
      onSfx(({ name, voice: v }) => {
        if (!v?.played) return;
        setLit(name);
        window.setTimeout(() => setLit((cur) => (cur === name ? null : cur)), 400);
      }),
    [],
  );
  useEffect(() => () => stopAll(), []);

  const play = (slot: string, take?: number) => {
    voice.current?.stop();
    voice.current = playVoice(id, slot, { variant, take });
  };

  return (
    <>
      <section className="ss-section" aria-labelledby="ss-companions">
        <div className="ss-head">
          <h2 id="ss-companions">Companions</h2>
          <span className="faint">Each has {VOICE_SLOT_IDS.length} voice slots</span>
        </div>
        <div className="ss-packs">
          {COMPANIONS.map((c) => {
            const n = filled(c.id);
            return (
              <button
                key={c.id}
                className={`ss-pack${c.id === id ? " on" : ""}${n > 0 && n < VOICE_SLOT_IDS.length ? " part" : ""}`}
                style={{ "--c": c.color } as CSSProperties}
                aria-pressed={c.id === id}
                onClick={() => setId(c.id)}
              >
                <span className="ss-pack-name">
                  <span className="ss-dot" />
                  {c.name}
                </span>
                <span className="ss-pack-blurb">{c.species}</span>
                <span className="ss-pack-meta">
                  <span className={n === VOICE_SLOT_IDS.length ? "" : "faint"}>{n === 0 ? "no voice yet" : `${n}/${VOICE_SLOT_IDS.length} slots`}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="ss-section" aria-labelledby="ss-voice-slots">
        <div className="ss-head">
          <h2 id="ss-voice-slots">{def.name}'s voice</h2>
          <div className="ss-seg" role="group" aria-label="Colour variant">
            <span className="label">Variant (pitch)</span>
            {VARIANTS.map((v) => (
              <button key={v} className={`btn small${variant === v ? " on" : ""}`} aria-pressed={variant === v} onClick={() => setVariant(v)} title={`Rate ×${variantPitch(v).toFixed(3)}`}>
                {v === 0 ? "Original" : `#${v}`}
              </button>
            ))}
            <button className="btn small" onClick={stopAll}>
              <Icon name="x" />
              Stop
            </button>
          </div>
        </div>
        {present === 0 && <p className="pill warn ss-muted">{def.name} has no voice files yet (see scripts/build-companion-sfx.mjs).</p>}
        <div className="panel ss-table-wrap scroll">
          <table className="ss-table">
            <thead>
              <tr>
                <th scope="col">Slot</th>
                <th scope="col">Says</th>
                <th scope="col">Takes</th>
              </tr>
            </thead>
            <tbody>
              {VOICE_SLOT_IDS.map((slot) => {
                const n = takeCount(id, slot);
                const line = voiceSlotLine(id, slot);
                return (
                  <tr key={slot}>
                    <th scope="row" className={lit === slot ? "lit" : ""} title={VOICE_SLOTS[slot]?.emotion}>
                      <code>{slot}</code>
                      <span className="faint">{voiceSlotLabel(slot)}</span>
                    </th>
                    <td>{line ? <span className="cv-line">“{line}”</span> : <span className="faint">—</span>}</td>
                    <td>
                      {n === 0 ? (
                        <span className="pill warn">missing</span>
                      ) : (
                        <span className="cv-takes">
                          <button className="btn small" disabled={!ready} onClick={() => play(slot)} aria-label={`Play ${slot}`}>
                            <Icon name="play" />
                            Play
                          </button>
                          {n > 1 &&
                            Array.from({ length: n }, (_, i) => (
                              <button key={i} className="btn small ghost" disabled={!ready} onClick={() => play(slot, i)} aria-label={`Play take ${i + 1} of ${slot}`}>
                                {i + 1}
                              </button>
                            ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint ss-hint">
          Hover a slot for the emotion it was generated from. The bubble text is real English; the sounds are non-verbal, so they only need to suit the line, not match it word for word.
        </p>
      </section>
    </>
  );
}
