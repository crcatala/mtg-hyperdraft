import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useStore } from "../store";
import { NameEditor, TopBar } from "../components/TopBar";
import { CardView } from "../components/CardView";
import { Icon } from "../components/Icon";
import { AnchoredPreview } from "../components/AnchoredPreview";
import { CardCarousel, type CarouselItem } from "../components/CardCarousel";
import { CubeBrowser } from "../components/CubeBrowser";
import { CharacterSelect, type PickTab } from "../components/CharacterSelect";
import { ScrollArea } from "../components/ScrollArea";
import { CompanionIcon, PlayerFace, petFilter } from "../components/Persona";
import { accentOf, avatarArt, avatarDef, companionDef, companionSmall, surprise } from "../roster";
import { saveLook } from "../identity";
import { cubeCards } from "../cubeList";
import type { CardData, DraftConfig, GameConfig, Player } from "../../shared/types";
import { DRAFT_PRESETS, MAX_HUMANS, MAX_SEATS, type DraftMode, type RarityGroup } from "../../shared/types";
import { cardsNeeded, matchesPreset, RARITY_GROUPS, validatePool } from "../../shared/draft";
import { quickstart, STARTER_CUBE } from "../quickstart";
import { presetSource } from "../../shared/presets";
import { durationLabel, PUBLIC_LIMITS } from "../../shared/publicRooms";
import { clockTime } from "../expiry";
import { SetImport } from "../components/SetImport";

const SAMPLE_CUBES = [
  { label: "Vintage Cube", value: "https://cubecobra.com/cube/list/vintage" },
  { label: "The Pauper Cube", value: "https://cubecobra.com/cube/list/thepaupercube" },
  { label: "LSV's Cube", value: "https://cubecobra.com/cube/list/LSVCube" },
];

export function Lobby() {
  const view = useStore((s) => s.view)!;
  const send = useStore((s) => s.send);
  const solo = useStore((s) => s.mode === "solo");
  const me = view.players.find((p) => p.id === view.you);
  const isHost = !!me?.isHost;
  const humans = view.players.filter((p) => !p.isBot);
  const waitingOn = humans.filter((p) => !p.ready);
  const importing = view.importStatus.state === "running";
  const [picking, setPicking] = useState<PickTab | null>(null);
  const closePicker = useCallback(() => setPicking(null), []);
  const banners = (solo ? 1 : 0) + (view.expiresAt !== null ? 1 : 0);

  return (
    <div className="screen lobby">
      <TopBar title="Lobby">
        <NameEditor />
      </TopBar>
      <div className={`lobby-grid scroll banners-${banners}`}>
        {solo && (
          <section className="panel solo-banner">
            <div>
              <h2>Solo draft</h2>
              <p className="muted">
                You and bots, running entirely in your browser: no account, no server. Nothing is saved, so closing the tab ends the game.
              </p>
            </div>
            <button className="btn primary big" disabled={importing || !!me?.ready} onClick={quickstart}>
              {importing ? "Importing…" : (
                <>
                  <Icon name="bolt" /> Quick start: {STARTER_CUBE.name}
                </>
              )}
            </button>
          </section>
        )}
        {view.expiresAt !== null && (
          <section className="panel solo-banner public-banner">
            <div>
              <h2>Public room · open until {clockTime(view.expiresAt)}</h2>
              <p className="muted">
                Hosted from the free public pool: it closes early once nobody's been here for {durationLabel(PUBLIC_LIMITS.idleMs)}, and nothing in it is
                kept. Anyone with the link can join.
              </p>
            </div>
          </section>
        )}
        <section className="panel lobby-players">
          <div className="section-head">
            <h2>Players</h2>
            <span className="muted">
              {solo ? `${view.players.length}/${MAX_SEATS} seats` : `${humans.length}/${MAX_HUMANS} friends · ${view.players.length}/${MAX_SEATS} seats`}
            </span>
          </div>
          {me && <CharacterCard me={me} onPick={setPicking} />}
          <ScrollArea className="seat-scroll" itemSelector=".seat-row" noun="player">
            <ul className="seat-list">
              {view.players.map((p) => (
                <SeatRow key={p.id} player={p} isMe={p.id === view.you} canKick={isHost && p.id !== view.you} onPick={setPicking} />
              ))}
            </ul>
          </ScrollArea>
          {isHost && (
            <button className="btn small" onClick={() => send({ t: "addBot" })} disabled={view.players.length >= MAX_SEATS}>
              <Icon name="plus" /> Add bot drafter
            </button>
          )}
          <p className="faint small-print">Bots draft alongside you (great for small groups or solo testing) but don't play on the table.</p>

          <div className="ready-box">
            {view.startBlocker ? (
              <p className="pill warn">{view.startBlocker}</p>
            ) : waitingOn.length > 0 ? (
              <p className="muted">
                Waiting on {waitingOn.map((p) => p.name).join(", ")} to ready up. The draft starts when everyone is ready.
              </p>
            ) : (
              <p className="muted">Everyone's ready!</p>
            )}
            <button className={`btn big ${me?.ready ? "on" : "primary"}`} onClick={() => send({ t: "setReady", ready: !me?.ready })}>
              {me?.ready ? (
                <>
                  <Icon name="check" /> Ready — click to unready
                </>
              ) : (
                "I'm ready to draft"
              )}
            </button>
          </div>
        </section>

        <CubePanel isHost={isHost} />
        <SettingsPanel isHost={isHost} />
      </div>
      {picking && <CharacterSelect initialTab={picking} onClose={closePicker} />}
    </div>
  );
}

/** Your avatar and companion at a glance, with the ways to change them. Both are optional. */
function CharacterCard({ me, onPick }: { me: Player; onPick: (tab: PickTab) => void }) {
  const players = useStore((s) => s.view!.players);
  const send = useStore((s) => s.send);
  const a = avatarDef(me.avatar);
  const c = companionDef(me.companion);
  const reroll = () => {
    const next = surprise(players, me.id);
    send({ t: "setLook", ...next });
    saveLook(next);
  };
  return (
    <div className="char-card" style={{ "--c": accentOf(me) } as React.CSSProperties}>
      <button className="char-portrait" onClick={() => onPick("avatar")} title={a ? "Change avatar" : "Choose an avatar"} aria-label={a ? `Your avatar is ${a.name}. Change avatar` : "You haven't chosen an avatar. Choose one"}>
        <img src={avatarArt(me.avatar)} alt="" />
      </button>
      <div className="char-info">
        <span className="char-kicker">Your avatar</span>
        {a ? (
          <>
            <b className="char-name">{a.name}</b>
            <span className="char-title">
              {a.title} · {a.race}
            </span>
          </>
        ) : (
          <>
            <b className="char-name">Mystery guest</b>
            <span className="char-title">Optional: pick a character, or stay hooded.</span>
          </>
        )}
        <span className="char-pet" title={c ? `${c.name} the ${c.species}` : "No companion"}>
          {c ? (
            <>
              <img src={companionSmall(c.id)} alt="" style={petFilter(me.companionVariant)} />
              <span className="char-pet-name">
                {c.name} <span className="faint">· {c.species}</span>
              </span>
            </>
          ) : (
            <span className="char-pet-name faint">No companion</span>
          )}
        </span>
      </div>
      <div className="char-actions">
        <button className="btn small" onClick={() => onPick("avatar")}>
          Avatar…
        </button>
        <button className="btn small" onClick={() => onPick("companion")}>
          Companion…
        </button>
        <button className="btn small icon-only" onClick={reroll} title="Surprise me: a random avatar and companion" aria-label="Surprise me">
          <Icon name="dice" />
        </button>
      </div>
    </div>
  );
}

function SeatRow({ player, isMe, canKick, onPick }: { player: Player; isMe: boolean; canKick: boolean; onPick: (tab: PickTab) => void }) {
  const send = useStore((s) => s.send);
  return (
    <li className={`seat-row${isMe ? " me" : ""}`}>
      {isMe ? (
        <button className="seat-face-btn" onClick={() => onPick("avatar")} title={player.avatar ? "Change avatar" : "Choose an avatar"} aria-label="Change your avatar">
          <PlayerFace player={player} size={40} tip={false} />
        </button>
      ) : (
        <PlayerFace player={player} size={40} focusable />
      )}
      <span className="seat-name">
        {player.name}
        {isMe && <span className="faint"> (you)</span>}
        {player.isHost && <Icon name="crown" className="crown" title="Host" />}
      </span>
      <span className="spacer" />
      {!player.isBot && !player.connected && (
        <span className="pill bad">
          <Icon name="offline" /> offline
        </span>
      )}
      {player.isBot ? <span className="pill">bot</span> : player.ready ? <span className="pill ok">ready</span> : <span className="pill">not ready</span>}
      <CompanionIcon player={player} size={34} />
      {canKick && (
        <button className="btn ghost small icon-only" title="Remove" aria-label={`Remove ${player.name}`} onClick={() => send({ t: "kick", playerId: player.id })}>
          <Icon name="x" />
        </button>
      )}
    </li>
  );
}

type SourceTab = "set" | "list";

function CubePanel({ isHost }: { isHost: boolean }) {
  const view = useStore((s) => s.view)!;
  const cards = useStore((s) => s.cards);
  const send = useStore((s) => s.send);
  const [changing, setChanging] = useState(false);
  const [tab, setTab] = useState<SourceTab | null>(null);
  // Kept here so a pasted list survives switching tiles or cancelling.
  const [listSource, setListSource] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const closeBrowser = useCallback(() => setBrowsing(false), []);
  const running = view.importStatus.state === "running";
  const cube = view.cube;
  const importSource = (source: string) => send({ t: "import", source });

  // A finished import replaces the picker with the new cube.
  useEffect(() => {
    setChanging(false);
    setTab(null);
    setListSource("");
  }, [cube?.importedAt]);

  // A handful of the cube's most exciting cards, for a visual "yes, this worked".
  const showcase = useMemo(() => {
    const list = Object.values(cards).filter((c) => !c.basic && !/Basic Land/.test(c.typeLine));
    const weight = { mythic: 4, special: 3, rare: 2, uncommon: 1, common: 0 };
    return list
      .sort((a, b) => weight[b.rarity] - weight[a.rarity] || (b.elo ?? 0) - (a.elo ?? 0))
      .slice(0, 7);
  }, [cards]);

  const pickerOpen = isHost && (!cube || changing);
  const suggestSetStyle = isHost && !!cube?.source.startsWith("set:") && view.config.draft.mode !== "set";

  return (
    <section className="panel lobby-cube">
      <div className="section-head">
        <h2>Cube</h2>
        {cube && (
          <div className="row cube-head-actions">
            <button className="pill ok pill-btn" onClick={() => setBrowsing(true)} title="Browse every card in this cube">
              <Icon name="grid" /> View all {cube.size} cards
            </button>
            {isHost && !changing && (
              <button className="btn ghost small" disabled={running} onClick={() => setChanging(true)}>
                Change cube
              </button>
            )}
          </div>
        )}
      </div>

      <ScrollArea className="panel-scroll">
        {browsing && cube && <CubeBrowser onClose={closeBrowser} />}
        {cube && (
          <div className="cube-summary">
            <div className="cube-name">{cube.name}</div>
            <div className="muted">
              {cube.uniqueCards} unique · {cube.source}
            </div>
            {suggestSetStyle && (
              <div className="style-hint">
                <span>This is a whole set: Set style builds packs like real boosters, and cards can repeat across packs.</span>
                <button className="btn small violet" onClick={() => send({ t: "config", draft: { mode: "set", ...DRAFT_PRESETS.set } })}>
                  Use set style
                </button>
              </div>
            )}
            {!pickerOpen && <Showcase cards={showcase} paused={browsing} />}
            {cube.notFound.length > 0 && (
              <div className="notice-box bad">
                <button className="btn ghost small" onClick={() => setShowMissing((v) => !v)}>
                  <Icon name={showMissing ? "chevron-down" : "chevron-right"} /> {cube.notFound.length} card(s) not found on Scryfall
                </button>
                {showMissing && <p className="missing-list">{cube.notFound.join(" · ")}</p>}
              </div>
            )}
            {cube.warnings.length > 0 && (
              <ul className="warnings">
                {cube.warnings.slice(0, 6).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {cube.warnings.length > 6 && <li>…and {cube.warnings.length - 6} more</li>}
              </ul>
            )}
          </div>
        )}
        {!cube && !isHost && <p className="muted">Waiting for the host to pick a cube…</p>}

        {pickerOpen && (
          <div className="cube-sources">
            <div className="cube-sources-head">
              <h3>{cube ? "Change cube" : "What are you drafting?"}</h3>
              {cube && (
                <button className="btn ghost small" onClick={() => setChanging(false)}>
                  Cancel
                </button>
              )}
            </div>
            <div className="source-tiles">
              <button className="source-tile" disabled={running} onClick={() => importSource(presetSource(STARTER_CUBE.id))}>
                <Icon name="bolt" />
                <b>Starter cube</b>
                <span>
                  {STARTER_CUBE.name} · {STARTER_CUBE.cards} cards, loads instantly
                </span>
              </button>
              <button className={`source-tile${tab === "set" ? " on" : ""}`} aria-expanded={tab === "set"} onClick={() => setTab((t) => (t === "set" ? null : "set"))}>
                <Icon name="search" />
                <b>Draft a set</b>
                <span>Any Magic set, by name or code</span>
              </button>
              <button className={`source-tile${tab === "list" ? " on" : ""}`} aria-expanded={tab === "list"} onClick={() => setTab((t) => (t === "list" ? null : "list"))}>
                <Icon name="book" />
                <b>Your own list</b>
                <span>CubeCobra link or a pasted card list</span>
              </button>
            </div>
            {tab === "set" && <SetImport running={running} onImport={(code) => importSource(`set:${code}`)} />}
            {tab === "list" && <ListImport running={running} source={listSource} onSourceChange={setListSource} onImport={importSource} />}
          </div>
        )}
        {running && (
          <div className="import-progress">
            <span className="spinner" /> {view.importStatus.message}
          </div>
        )}
        {view.importStatus.state === "error" && <p className="pill bad">{view.importStatus.message}</p>}
      </ScrollArea>
    </section>
  );
}

/** A CubeCobra link or a pasted list. */
function ListImport({
  running,
  source,
  onSourceChange: setSource,
  onImport,
}: {
  running: boolean;
  source: string;
  onSourceChange: (source: string) => void;
  onImport: (source: string) => void;
}) {
  const solo = useStore((s) => s.mode === "solo");
  return (
    <div className="list-import">
      <label className="field-name" htmlFor="import">
        CubeCobra link or card list
      </label>
      <textarea
        id="import"
        className="textarea"
        rows={4}
        placeholder={"https://cubecobra.com/cube/list/vintage\n— or —\n1 Lightning Bolt\nBrazen Borrower (ELD) 39"}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        disabled={running}
        autoFocus
      />
      <div className="row wrap">
        <button className="btn primary" disabled={running || !source.trim()} onClick={() => onImport(source)}>
          {running ? "Importing…" : "Import"}
        </button>
        <span className="faint small-print">Try</span>
        {SAMPLE_CUBES.map((s) => (
          <button key={s.value} className="btn ghost small" disabled={running} onClick={() => setSource(s.value)}>
            {s.label}
          </button>
        ))}
      </div>
      {/* A disclosure rather than a tooltip, so it opens with a tap too. */}
      <details className="list-formats">
        <summary>Accepted formats</summary>
        <p className="field-hint">
          CubeCobra links, one card per line, "4 Card Name", Arena "Card (SET) 123" lines, CubeCobra CSV exports and "set:WTH". Card data is looked up on Scryfall
          {solo ? " straight from your browser." : " and saved with the lobby."}
        </p>
      </details>
    </div>
  );
}

const TIMER_OPTIONS = [0, 30, 45, 60, 75, 90, 120];
const STYLE_NAMES: Record<DraftMode, string> = { cube: "Cube", set: "Set" };
const STYLE_BLURBS: Record<DraftMode, string> = {
  cube: "Packs of 15 dealt at random from the whole list, every card once. Made for cubes.",
  set: "Packs built like boosters (1 rare or mythic, 3 uncommons, 10 commons), and cards can repeat across packs. Made for drafting a set.",
};
const SLOT_LABELS: Record<RarityGroup, string> = { rare: "Rares & mythics", uncommon: "Uncommons", common: "Commons" };
const SLOT_CAPS: Record<RarityGroup, number> = { rare: 15, uncommon: 15, common: 30 };

function SettingsPanel({ isHost }: { isHost: boolean }) {
  const view = useStore((s) => s.view)!;
  const send = useStore((s) => s.send);
  const d = view.config.draft;
  const g = view.config.game;
  const setDraft = (patch: Partial<DraftConfig>) => send({ t: "config", draft: patch });
  const setGame = (patch: Partial<GameConfig>) => send({ t: "config", game: patch });
  const pickStyle = (mode: DraftMode) => setDraft({ mode, ...DRAFT_PRESETS[mode] });

  return (
    <section className="panel lobby-settings">
      <div className="section-head">
        <h2>Draft settings</h2>
        {!isHost && <span className="faint">host controls these</span>}
      </div>
      <ScrollArea className="panel-scroll">
        <PoolStatus />
        <fieldset disabled={!isHost} className="draft-style">
          <span className="label" id="draft-style-label">
            Draft style
          </span>
          <div className="row wrap">
            <div className="draft-style-options" role="radiogroup" aria-labelledby="draft-style-label">
              {(["cube", "set"] as const).map((mode) => (
                <button
                  key={mode}
                  role="radio"
                  aria-checked={d.mode === mode}
                  className={`btn small${d.mode === mode ? " on" : ""}`}
                  onClick={() => pickStyle(mode)}
                  title={d.mode === mode ? `Reset to the ${STYLE_NAMES[mode]} defaults` : undefined}
                >
                  {STYLE_NAMES[mode]}
                </button>
              ))}
            </div>
            {!matchesPreset(d, d.mode) && <span className="pill">Modified · pick {STYLE_NAMES[d.mode]} again to reset</span>}
          </div>
          <p className="field-hint">{STYLE_BLURBS[d.mode]}</p>
        </fieldset>
        <fieldset disabled={!isHost} className="setting-list">
          <NumberRow label="Packs per player" value={d.packsPerPlayer} min={1} max={6} onChange={(v) => setDraft({ packsPerPlayer: v })} />
          <NumberRow
            label="Cards per pack"
            value={d.cardsPerPack}
            min={2}
            max={30}
            onChange={(v) => setDraft({ cardsPerPack: v })}
            disabled={!!d.packSlots}
            hint={d.packSlots ? "Set by the rarity counts in Pack contents" : undefined}
          />
          <NumberRow label="Picks per turn" value={d.picksPerTurn} min={1} max={5} onChange={(v) => setDraft({ picksPerTurn: v })} />
          <NumberRow label="Burns per turn" value={d.burnsPerTurn} min={0} max={5} onChange={(v) => setDraft({ burnsPerTurn: v })} hint="Discard extra cards each pick; speeds up small pods" />
          <SettingRow label="Passing" htmlFor="set-passing">
            <select id="set-passing" className="select" value={d.passPattern} onChange={(e) => setDraft({ passPattern: e.target.value as DraftConfig["passPattern"] })}>
              <option value="alternate">Left, right, left</option>
              <option value="left">Always left</option>
            </select>
          </SettingRow>
          <SettingRow label="Pick timer" htmlFor="set-timer">
            <div className="row setting-controls">
              {d.pickTimerSec > 0 && (
                <select className="select" aria-label="Timer style" value={d.timerStyle} onChange={(e) => setDraft({ timerStyle: e.target.value as DraftConfig["timerStyle"] })}>
                  <option value="fixed">Same every pick</option>
                  <option value="shrinking">Shrinks with pack</option>
                </select>
              )}
              <select id="set-timer" className="select" value={d.pickTimerSec} onChange={(e) => setDraft({ pickTimerSec: Number(e.target.value) })}>
                {TIMER_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t === 0 ? "No limit" : `${t}s`}
                  </option>
                ))}
              </select>
            </div>
          </SettingRow>
        </fieldset>
        <PackContents config={d} disabled={!isHost} onChange={setDraft} />
        <Collapsible title="Game rules" summary={`${g.startingLife} life · ${g.minDeckSize}-card decks · ${g.openingHandSize}-card hand`}>
          <fieldset disabled={!isHost} className="setting-list">
            <NumberRow label="Starting life" value={g.startingLife} min={1} max={999} onChange={(v) => setGame({ startingLife: v })} />
            <NumberRow label="Minimum deck size" value={g.minDeckSize} min={1} max={200} onChange={(v) => setGame({ minDeckSize: v })} />
            <NumberRow label="Opening hand" value={g.openingHandSize} min={0} max={20} onChange={(v) => setGame({ openingHandSize: v })} />
          </fieldset>
        </Collapsible>
      </ScrollArea>
    </section>
  );
}

/** Whether the cube can fill the packs: the one check that decides if the draft can start. */
function PoolStatus() {
  const view = useStore((s) => s.view)!;
  const d = view.config.draft;
  const seats = view.players.length;
  const shape = `${seats} seat${seats === 1 ? "" : "s"} × ${d.packsPerPlayer} packs × ${d.cardsPerPack} cards`;
  const needs = d.allowDuplicates ? `${shape}, repeats allowed` : `${shape} = ${cardsNeeded(seats, d)} cards`;
  if (!view.cube) {
    return <p className="pool-status">{needs} · no cube yet</p>;
  }
  const problem = validatePool(view.cube.stats, seats, d);
  return problem ? (
    <p className="pool-status bad">
      <Icon name="x" /> <span>{problem}</span>
    </p>
  ) : (
    <p className="pool-status ok">
      <Icon name="check" />
      <span>
        {needs} · cube has {view.cube.size}
      </span>
    </p>
  );
}

/** A titled, collapsible group of settings with a one-line summary of what's inside. */
function Collapsible({ title, summary, defaultOpen = false, children }: { title: string; summary: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="setting-group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Icon name={open ? "chevron-down" : "chevron-right"} />
        <span className="label">{title}</span>
        <span className="setting-group-summary">{summary}</span>
      </summary>
      <div className="setting-group-body">{children}</div>
    </details>
  );
}

/** Advanced pack options: rarity counts per pack, duplicates and foils. Open by default once rarity or duplicates are in use. */
function PackContents({ config: d, disabled, onChange }: { config: DraftConfig; disabled: boolean; onChange: (patch: Partial<DraftConfig>) => void }) {
  const slots = d.packSlots;
  const total = slots ? RARITY_GROUPS.reduce((sum, r) => sum + slots[r], 0) : d.cardsPerPack;
  const summary = [
    slots ? RARITY_GROUPS.map((r) => `${slots[r]} ${r}`).join(" · ") : "random cards",
    d.allowDuplicates ? "repeats across packs" : "every card once",
  ].join(" · ");
  return (
    <Collapsible title="Pack contents" summary={summary} defaultOpen={!!d.packSlots || d.allowDuplicates}>
      <fieldset disabled={disabled} className="setting-list">
        <label className="setting-row check">
          <span className="field-name">Build packs by rarity</span>
          <input
            type="checkbox"
            checked={!!slots}
            onChange={(e) => onChange(e.target.checked ? { packSlots: DRAFT_PRESETS.set.packSlots } : { packSlots: null, cardsPerPack: total })}
          />
        </label>
        {slots && (
          <div className="slot-rows">
            {RARITY_GROUPS.map((r) => {
              const others = total - slots[r];
              return (
                <NumberRow
                  key={r}
                  label={SLOT_LABELS[r]}
                  value={slots[r]}
                  min={Math.max(0, 2 - others)}
                  max={Math.min(SLOT_CAPS[r], 30 - others)}
                  onChange={(v) => onChange({ packSlots: { ...slots, [r]: v } })}
                  hint={r === "rare" ? "Rares come up twice as often as mythics, like a real print sheet" : undefined}
                />
              );
            })}
          </div>
        )}
        <label className="setting-row check">
          <span>
            <span className="field-name">Allow duplicates across packs</span>
            <span className="field-hint">A card never appears twice in one pack</span>
          </span>
          <input type="checkbox" checked={d.allowDuplicates} onChange={(e) => onChange({ allowDuplicates: e.target.checked })} />
        </label>
        <SettingRow label="Foil chance per pack" htmlFor="set-foil">
          <div className="row setting-controls">
            <input id="set-foil" type="range" min={0} max={1} step={0.05} value={d.foilChance} onChange={(e) => onChange({ foilChance: Number(e.target.value) })} />
            <span className="setting-value">{Math.round(d.foilChance * 100)}%</span>
          </div>
        </SettingRow>
      </fieldset>
    </Collapsible>
  );
}

/** One setting: name (and an optional hint) on the left, its control on the right. */
function SettingRow({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span>
        <label className="field-name" htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= min && n <= max && n !== value) onChange(n);
  };
  return (
    <SettingRow label={label} hint={hint} htmlFor={id}>
      <div className="stepper compact">
        <button type="button" className="btn small icon-only" aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
          <Icon name="minus" />
        </button>
        <input
          id={id}
          className="input"
          inputMode="numeric"
          disabled={disabled}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
        />
        <button type="button" className="btn small icon-only" aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
          <Icon name="plus" />
        </button>
      </div>
    </SettingRow>
  );
}

/**
 * The cube's headline cards, fanned out. Hover previews a card; click selects it, and clicking the
 * selected card opens the zoom carousel, which browses the whole cube (like picking in the draft).
 */
function Showcase({ cards, paused }: { cards: CardData[]; /** The cube browser is open and owns Esc. */ paused: boolean }) {
  const all = useStore((s) => s.cards);
  const basicIds = useStore((s) => s.view?.basicIds);
  const cubeName = useStore((s) => s.view?.cube?.name);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [hover, setHover] = useState<{ card: CardData; rect: DOMRect } | null>(null);
  const items = useMemo<CarouselItem[]>(() => (zoom ? cubeCards(all, basicIds).map((c) => ({ key: c.id, card: c })) : []), [zoom, all, basicIds]);
  const originFor = useCallback((key: string) => document.querySelector(`.showcase-card[data-card="${CSS.escape(key)}"]`)?.getBoundingClientRect() ?? null, []);
  const closeZoom = useCallback(() => setZoom(null), []);

  useEffect(() => {
    if (!selected || zoom || paused) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, zoom, paused]);

  return (
    <>
      <div className="showcase">
        {cards.map((c, i) => (
          <CardView
            key={c.id}
            card={c}
            width={112}
            tilt
            selected={selected === c.id}
            data-card={c.id}
            style={{ "--i": i, "--n": cards.length } as React.CSSProperties}
            className={`showcase-card${selected === c.id ? " is-selected" : ""}`}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHover({ card: c, rect: e.currentTarget.getBoundingClientRect() })}
            onPointerLeave={() => setHover((h) => (h?.card.id === c.id ? null : h))}
            onClick={() => {
              if (selected === c.id) {
                setHover(null);
                setZoom(c.id);
              } else setSelected(c.id);
            }}
          />
        ))}
      </div>
      <p className="faint small-print showcase-hint">{selected ? "Click the selected card again to zoom in and browse the whole cube" : "Hover a card to preview it · click to select"}</p>
      {hover && !zoom && <AnchoredPreview card={hover.card} anchor={hover.rect} prefer="right" />}
      {zoom && items.length > 0 && <CardCarousel key={zoom} items={items} startKey={zoom} title={cubeName ?? "Cube"} originFor={originFor} onClose={closeZoom} />}
    </>
  );
}
