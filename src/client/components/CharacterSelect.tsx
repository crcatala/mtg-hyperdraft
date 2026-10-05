// Character select: pick your avatar and table companion in the lobby. Both are optional: the first
// tile clears the choice (other players then see a hooded stranger, or no companion). Hover or focus an
// entry to read about them; click to take it. Several players may pick the same one: whoever comes
// later gets a different colour so they can be told apart. Changes apply at once.

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import type { Player } from "../../shared/types";
import { loadLook, mergeLook, saveLook } from "../identity";
import { AVATARS, COMPANIONS, accentOf, avatarArt, avatarDef, avatarFace, companionArt, companionDef, companionSmall, holders, surprise } from "../roster";
import { petFilter } from "./Persona";
import { Icon } from "./Icon";

export type PickTab = "avatar" | "companion";

const TABS: { id: PickTab; label: string }[] = [
  { id: "avatar", label: "Avatar" },
  { id: "companion", label: "Companion" },
];

/** The peek id for the "none" tile. */
const NONE = "__none";

const namesOf = (players: Player[]) => players.map((p) => p.name).join(", ");

export function CharacterSelect({ initialTab = "avatar", onClose }: { initialTab?: PickTab; onClose: () => void }) {
  const view = useStore((s) => s.view)!;
  const send = useStore((s) => s.send);
  const me = view.players.find((p) => p.id === view.you);
  const [tab, setTab] = useState<PickTab>(initialTab);
  const [peek, setPeek] = useState<string | null>(null);
  const titleId = useId();
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus moves in on open and back to whatever had it on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    document.getElementById(`${baseId}-tab-${initialTab}`)?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, [baseId, initialTab]);

  // Esc closes (capture phase, so the screen behind doesn't also react).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // The lobby can end (draft starts) while this is open.
  useEffect(() => {
    if (view.phase !== "lobby") onClose();
  }, [view.phase, onClose]);

  if (!me) return null;
  const held = holders(view.players, tab);
  const current = me[tab] ?? NONE;
  const shownId = peek ?? current;

  /** `id` null clears the choice. */
  const choose = (id: string | null) => {
    if ((id ?? NONE) === current) return;
    send({ t: "setLook", [tab]: id });
    // Built from what is saved, not from `me`: a pick made a moment ago may not be in the room view yet.
    saveLook(mergeLook(loadLook(), tab, id));
  };

  const roll = () => {
    const s = surprise(view.players, me.id);
    choose(tab === "avatar" ? s.avatar : s.companion);
    setPeek(null);
  };

  const trapTab = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]")].filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
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
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length].id;
    setTab(next);
    setPeek(null);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  };

  const others = (id: string) => (held.get(id) ?? []).filter((p) => p.id !== me.id);

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel charselect" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapTab}>
        <header className="charselect-head">
          <h2 id={titleId}>Choose your look</h2>
          <div className="charselect-tabs" role="tablist" aria-label="What to change" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`${baseId}-tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`${baseId}-panel`}
                tabIndex={tab === t.id ? 0 : -1}
                className="charselect-tab"
                onClick={() => {
                  setTab(t.id);
                  setPeek(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button className="btn ghost small icon-only" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </header>

        <div className="charselect-body" id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`}>
          {tab === "avatar" ? (
            <AvatarPreview id={shownId} me={me} sharedWith={shownId !== NONE ? others(shownId) : []} />
          ) : (
            <CompanionPreview id={shownId} me={me} sharedWith={shownId !== NONE ? others(shownId) : []} />
          )}

          <div className="charselect-grid scroll" role="group" aria-label={tab === "avatar" ? "Avatars" : "Companions"} onPointerLeave={() => setPeek(null)}>
            <button
              type="button"
              className={`pick none${current === NONE ? " mine" : ""}`}
              aria-pressed={current === NONE}
              aria-label={tab === "avatar" ? "No avatar: stay a mystery" : "No companion"}
              onPointerEnter={() => setPeek(NONE)}
              onFocus={() => setPeek(NONE)}
              onBlur={() => setPeek(null)}
              onClick={() => choose(null)}
            >
              {tab === "avatar" ? <img src={avatarFace()} alt="" draggable={false} /> : <span className="pick-empty" aria-hidden />}
              <span className="pick-name">{tab === "avatar" ? "Mystery" : "None"}</span>
              {current === NONE && <span className="pick-owner you">You</span>}
            </button>
            {(tab === "avatar" ? AVATARS : COMPANIONS).map((d) => {
              const sharing = others(d.id);
              const isMine = d.id === current;
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`pick${isMine ? " mine" : ""}`}
                  style={{ "--c": d.color } as CSSProperties}
                  aria-pressed={isMine}
                  aria-label={sharing.length ? `${d.name}, also chosen by ${namesOf(sharing)}` : d.name}
                  onPointerEnter={() => setPeek(d.id)}
                  onFocus={() => setPeek(d.id)}
                  onBlur={() => setPeek(null)}
                  onClick={() => choose(d.id)}
                >
                  <img src={tab === "avatar" ? avatarFace(d.id) : companionSmall(d.id)} alt="" draggable={false} loading="lazy" />
                  <span className="pick-name">{tab === "avatar" ? d.name.split(" ")[0] : d.name}</span>
                  {isMine ? <span className="pick-owner you">You</span> : sharing.length > 0 && <span className="pick-owner">{namesOf(sharing)}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <footer className="charselect-foot">
          <button className="btn" onClick={roll}>
            <Icon name="dice" /> Surprise me
          </button>
          <span className="faint charselect-note">Totally optional. If you pick the same one as someone else, you each get your own colours.</span>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function ManaDots({ mana }: { mana: string }) {
  return (
    <span className="mana-dots" title={`Plays ${mana.split("").join("/")}`}>
      {mana.split("").map((m) => (
        <i key={m} className={`ms ms-${m.toLowerCase()} ms-cost`} />
      ))}
    </span>
  );
}

function SharedNote({ sharedWith, what }: { sharedWith: Player[]; what: string }) {
  if (sharedWith.length === 0) return null;
  return (
    <p className="pinfo-shared">
      {namesOf(sharedWith)} {sharedWith.length === 1 ? "has" : "have"} this {what} too. You'd each get your own colours, so you can tell apart.
    </p>
  );
}

function AvatarPreview({ id, me, sharedWith }: { id: string; me: Player; sharedWith: Player[] }) {
  const a = id === NONE ? undefined : avatarDef(id);
  const mine = id === (me.avatar ?? NONE);
  // Your own pick shows in the colour you actually have; a candidate shows in its original colour.
  const color = mine ? accentOf(me) : a?.color ?? accentOf({});
  return (
    <section className="charselect-preview" style={{ "--c": color } as CSSProperties} aria-live="polite">
      <div className="pstage">
        <img key={a?.id ?? NONE} src={avatarArt(a?.id)} alt={a?.name ?? "A hooded stranger"} />
      </div>
      <div className="pinfo">
        {a ? (
          <>
            <span className="pinfo-kicker">
              {a.title} · {a.race} <ManaDots mana={a.mana} />
            </span>
            <h3>{a.name}</h3>
            <SharedNote sharedWith={sharedWith} what="avatar" />
            <p className="pinfo-quote">{a.quote}</p>
            <p>{a.backstory}</p>
            <p className="faint">
              <b>Personality.</b> {a.personality}
            </p>
            <p className="faint">
              <b>Plays like.</b> {a.archetype}
            </p>
          </>
        ) : (
          <>
            <span className="pinfo-kicker">No avatar</span>
            <h3>The Hooded Stranger</h3>
            <p>You don't have to be anyone. Everyone else sees a mysterious figure in your seat, and you can pick a character whenever you like.</p>
          </>
        )}
        {mine && <span className="pill ok">{a ? "Your avatar" : "Your choice"}</span>}
      </div>
    </section>
  );
}

function CompanionPreview({ id, me, sharedWith }: { id: string; me: Player; sharedWith: Player[] }) {
  const c = id === NONE ? undefined : companionDef(id);
  const mine = id === (me.companion ?? NONE);
  return (
    <section className="charselect-preview companion" style={{ "--c": c?.color ?? accentOf({}) } as CSSProperties} aria-live="polite">
      <div className="pstage">
        {c ? <img key={c.id} src={companionArt(c.id)} alt={c.name} style={mine ? petFilter(me.companionVariant) : undefined} /> : <span className="pstage-empty">No companion</span>}
      </div>
      <div className="pinfo">
        {c ? (
          <>
            <span className="pinfo-kicker">{c.species}</span>
            <h3>{c.name}</h3>
            <SharedNote sharedWith={sharedWith} what="companion" />
            <p>{c.personality}</p>
            <p className="faint">
              <b>Will learn to:</b> {c.emotes.join(" · ").toLowerCase()}
            </p>
            <p className="faint">Your companion stands in front of your mat during the game and hops on your turn. It's a picture for now; 3D versions are planned.</p>
          </>
        ) : (
          <>
            <span className="pinfo-kicker">No companion</span>
            <h3>Flying solo</h3>
            <p>Your side of the table stays clear. You can add a companion any time before the draft starts.</p>
          </>
        )}
        {mine && <span className="pill ok">{c ? "Your companion" : "Your choice"}</span>}
      </div>
    </section>
  );
}
