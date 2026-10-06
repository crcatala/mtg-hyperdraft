// The Treatomancer's HUD: its menu (pick a treat, spend glimmers, fire it), the tag over the machine telling
// everyone else who's browsing it (and then what they bought), and the treat's name tag on the table while the
// companions race for it. The machine and the show are Treatomancer.tsx, TreatFlight.tsx and treatShow.ts.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { aTreat, GLIMMER_START, glimmersLeft, theTreat, TREATS, treatDef, type TreatDef } from "../../shared/treats";
import { serverNow, useStore } from "../store";
import { companionDef } from "../../shared/roster";
import { companionSmall } from "../roster";
import { PlayerFace, petFilter } from "../components/Persona";
import { Icon } from "../components/Icon";
import { treatSound } from "../treatSounds";
import { buyTreat, closeVend, syncVendFromView } from "./treatShow";
import { machineAnchor, showTime, useTreats } from "./treatState";
import { treatAnchor, treatArt } from "./TreatFlight";
import "../treats.css";

/** The menu, the machine's tag and the treat's tag: everything the Treatomancer puts on the HUD. */
export function TreatHud() {
  // A room view carries who holds the machine (a screen that just joined, or missed the message).
  const vend = useStore((s) => s.view?.vend);
  useEffect(() => syncVendFromView(), [vend?.by, vend?.until]);
  return (
    <>
      <MachineTag />
      <TreatTag />
      <TreatMenu />
    </>
  );
}

function TreatMenu() {
  const open = useTreats((s) => s.open);
  const holdUntil = useTreats((s) => s.vend?.until ?? 0);
  const left = useStore((s) => glimmersLeft(s.view?.table?.players[s.view.you]));
  const [picked, setPicked] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    if (!open) return;
    setPicked((p) => p ?? TREATS.find((t) => t.cost <= left)?.id ?? null);
    const tick = setInterval(() => setNow(serverNow()), 500);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeVend();
    };
    window.addEventListener("keydown", key, true);
    return () => {
      clearInterval(tick);
      window.removeEventListener("keydown", key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // The hold runs out: the machine lets go.
  useEffect(() => {
    if (open && holdUntil && now > holdUntil) closeVend();
  }, [open, now, holdUntil]);
  useEffect(() => {
    if (!open) setPicked(null);
  }, [open]);

  if (!open) return null;
  const def = treatDef(picked ?? undefined);
  const afford = !!def && def.cost <= left;
  const secs = Math.max(0, Math.ceil((holdUntil - now) / 1000));
  const pick = (t: TreatDef) => {
    setPicked(t.id);
    treatSound(t.cost <= left ? "pick" : "denied", { rate: 0.9 + t.cost * 0.04 });
  };

  return (
    <div className="modal-backdrop treat-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeVend()}>
      <div className="modal panel treat-menu" role="dialog" aria-modal="true" aria-labelledby="treat-title">
        <header className="treat-head">
          <div className="treat-title-wrap">
            <h2 id="treat-title">The Treatomancer</h2>
            <p className="treat-sub">Feed it glimmers. It feeds the companions. Whoever gets there first, keeps it.</p>
          </div>
          <div className="treat-purse" title={`Every player gets ${GLIMMER_START} glimmers a game`}>
            <span className="treat-purse-label">Your glimmer pouch</span>
            <span className="treat-purse-count">
              <Glimmer /> {left}
              <small> / {GLIMMER_START}</small>
            </span>
          </div>
          <button type="button" className="btn small icon-only treat-x" aria-label="Close" onClick={() => closeVend()}>
            <Icon name="x" />
          </button>
        </header>

        <div className="treat-grid" role="radiogroup" aria-label="Treats">
          {TREATS.map((t) => {
            const pricey = t.cost > left;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={picked === t.id}
                className={`treat-slot${pricey ? " pricey" : ""}`}
                style={{ "--tc": t.color } as CSSProperties}
                onClick={() => pick(t)}
                onDoubleClick={() => !pricey && buyTreat(t.id)}
              >
                <span className="treat-orb">
                  <img src={treatArt(t.id)} alt="" width={96} height={96} draggable={false} />
                </span>
                <span className="treat-name">{t.name}</span>
                <span className="treat-cost">
                  <Glimmer /> {t.cost}
                </span>
              </button>
            );
          })}
        </div>

        <footer className="treat-foot" style={{ "--tc": def?.color ?? "var(--gold)" } as CSSProperties}>
          {def ? (
            <div className="treat-pick">
              <img src={treatArt(def.id)} alt="" width={64} height={64} />
              <div>
                <b>{def.name}</b>
                <span className="treat-blurb">{def.blurb}</span>
                <span className="treat-kind">{def.kind === "eat" ? "Snack: the winner gobbles it." : "Keepsake: the winner hugs it forever."}</span>
              </div>
            </div>
          ) : (
            <div className="treat-pick faint">Pick a treat.</div>
          )}
          <div className="treat-actions">
            <span className="treat-timer faint" aria-live="off">
              The machine gets bored in {secs}s
            </span>
            <button
              ref={confirmRef}
              type="button"
              className="btn primary treat-go"
              disabled={!afford}
              onClick={() => def && buyTreat(def.id)}
            >
              {def && !afford ? "Not enough glimmers" : <>Feed it {def?.cost ?? ""} <Glimmer /> &amp; launch!</>}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** The glimmer: a little four-pointed star in gold. */
export function Glimmer() {
  return <Icon name="sparkle" className="glimmer" />;
}

/** Places an element over a screen anchor every frame (or pins it to the top of the screen when it's out of view). */
function useAnchored(ref: React.RefObject<HTMLDivElement | null>, anchor: { x: number; y: number; on: boolean }, live: boolean, pin = true) {
  useLayoutEffect(() => {
    if (!live) return;
    let frame = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (anchor.on) {
          const x = Math.min(Math.max(anchor.x - w / 2, 8), window.innerWidth - w - 8);
          const y = Math.min(Math.max(anchor.y - h - 10, 8), window.innerHeight - h - 8);
          el.style.transform = `translate(${x}px, ${y}px)`;
          el.style.opacity = "1";
        } else if (pin) {
          el.style.transform = `translate(${(window.innerWidth - w) / 2}px, 64px)`;
          el.style.opacity = "1";
        } else el.style.opacity = "0";
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ref, anchor, live, pin]);
}

/**
 * Over the machine, for everyone: who is browsing it ("Alice is browsing treats…"), then, once they've bought,
 * what's coming, then who got it. Not shown to the browser themselves (they have the menu).
 */
function MachineTag() {
  const vendBy = useTreats((s) => s.vend?.by ?? null);
  const show = useTreats((s) => s.show);
  const view = useStore((s) => s.view);
  const ref = useRef<HTMLDivElement>(null);
  const [, bump] = useState(0);
  // Re-render as the show moves from "bought" to "got it".
  useEffect(() => {
    if (!show) return;
    const iv = setInterval(() => bump((n) => n + 1), 200);
    return () => clearInterval(iv);
  }, [show]);
  const t = showTime();
  let content: React.ReactNode = null;
  let key = "";
  if (show && t !== null && t < show.plan.homeAt) {
    const buyer = view?.players.find((p) => p.id === show.spec.by);
    const def = treatDef(show.spec.treat);
    const winner = view?.players.find((p) => p.id === show.plan.winner);
    const pet = companionDef(winner?.companion);
    if (t >= show.plan.takenAt && winner && pet) {
      key = "won";
      content = (
        <>
          <img className="mtag-pet" src={companionSmall(pet.id)} alt="" width={30} height={30} style={petFilter(winner.companionVariant)} />
          <span>
            <b>{pet.name}</b> snagged {def ? theTreat(def) : "the treat"}!
          </span>
        </>
      );
    } else if (buyer && def) {
      key = "bought";
      content = (
        <>
          <PlayerFace player={buyer} size={28} tip={false} />
          <span>
            <b>{buyer.id === view?.you ? "You" : buyer.name}</b> launched {aTreat(def)}!
          </span>
          <img className="mtag-treat" src={treatArt(def.id)} alt="" width={30} height={30} />
        </>
      );
    }
  } else if (vendBy && vendBy !== view?.you) {
    const who = view?.players.find((p) => p.id === vendBy);
    if (who) {
      key = "browse";
      content = (
        <>
          <PlayerFace player={who} size={28} tip={false} />
          <span>
            <b>{who.name}</b> is browsing treats<span className="mtag-dots" aria-hidden />
          </span>
        </>
      );
    }
  }
  useAnchored(ref, machineAnchor, !!content);
  return (
    <>
      {content && (
        <div key={key} ref={ref} className={`machine-tag ${key}`} aria-hidden>
          {content}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {key === "browse" ? "Someone is browsing the Treatomancer." : key === "bought" ? "A treat was launched onto the table!" : ""}
      </div>
    </>
  );
}

/** The treat's name, over it on the table while it's up for grabs. */
function TreatTag() {
  const show = useTreats((s) => s.show);
  const ref = useRef<HTMLDivElement>(null);
  const def = treatDef(show?.spec.treat);
  useAnchored(ref, treatAnchor, !!def, false);
  if (!show || !def) return null;
  return (
    <div ref={ref} key={show.start} className="treat-tag" style={{ "--tc": def.color, opacity: 0 } as CSSProperties} aria-hidden>
      {def.name}
    </div>
  );
}
