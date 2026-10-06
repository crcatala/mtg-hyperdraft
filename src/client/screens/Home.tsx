import { useCallback, useEffect, useReducer, useState } from "react";
import { roomExists } from "../net";
import { loadName, saveName } from "../identity";
import { createRoom, deleteRoom, fetchInvite, forgetInvite, InviteError, loadInvite, loadInviteInfo, saveInvite } from "../invite";
import { createPublicRoom, fetchPublicStatus, loadMine, loadPublicStatus, PublicRoomError, rememberMine, useTurnstile } from "../publicRooms";
import { forgetRoom, loadRecent, mergeRooms, rememberRoom, type RoomEntry } from "../recentRooms";
import { clockTime } from "../expiry";
import { navigate } from "../router";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { ThemePicker } from "../components/ThemePicker";
import { TitleBackdrop } from "../scene/TitleBackdrop";
import { canUse3d } from "../pack/support";
import { useTheme } from "../theme";
import { ROOM_CODE_LENGTH, ROOM_CODE_RE } from "../../shared/roomCode";
import type { RoomRecord } from "../../shared/invites";
import { durationLabel, PUBLIC_LIMITS, type PublicStatus } from "../../shared/publicRooms";

export function Home() {
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const invite = useInvite();
  const theme = useTheme();
  const scene = canUse3d();

  const needName = () => {
    if (name.trim()) {
      saveName(name.trim());
      return false;
    }
    toast("Pick a name first.", "error");
    return true;
  };

  const join = async () => {
    const c = code.trim().toUpperCase();
    if (needName()) return;
    if (!ROOM_CODE_RE.test(c)) return toast(`Room codes are ${ROOM_CODE_LENGTH} letters/numbers.`, "error");
    setBusy(true);
    try {
      if (await roomExists(c)) navigate(`/r/${c}`);
      else toast(`No room with code ${c}.`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`screen home${scene ? " has-scene" : ""}`}>
      {scene && <TitleBackdrop theme={theme} />}
      <div className="home-fan" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="home-fan-card" style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>
      <div className="center-stage">
        <div className="home-hero">
          <p className="home-kicker">Cube draft &amp; tabletop · 1–4 players</p>
          <h1 className="brand home-title">HyperDraft</h1>
          <p className="home-tag">Crack packs, draft a cube with up to three friends, build your deck, and battle on a shared 3D table.</p>
          <ol className="home-steps" aria-label="How it works">
            <li>
              <b>Crack</b> <span>packs from any cube</span>
            </li>
            <li>
              <b>Draft</b> <span>with friends or bots</span>
            </li>
            <li>
              <b>Build</b> <span>your deck, basics free</span>
            </li>
            <li>
              <b>Play</b> <span>on a shared 3D table</span>
            </li>
          </ol>
          <div className="panel home-panel">
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input id="name" className="input" value={name} maxLength={24} placeholder="e.g. Chandra" onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="btn primary big" onClick={() => !needName() && navigate("/solo")}>
              <Icon name="play" /> Play solo vs bots
            </button>
            <p className="faint small-print home-note">Runs entirely in your browser. No invite or sign-up needed.</p>

            <div className="home-or">
              <span>or play with friends</span>
            </div>
            <div className="row">
              <input
                className="input code-input"
                value={code}
                maxLength={ROOM_CODE_LENGTH}
                placeholder="CODE"
                aria-label="Room code"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && join()}
              />
              <button className="btn violet" disabled={busy} onClick={join}>
                Join
              </button>
            </div>
            <HostSection needName={needName} invite={invite} />
          </div>
          <YourRooms ledger={invite.info?.rooms ?? []} onDelete={invite.key ? invite.remove : undefined} />
        </div>
      </div>
      <footer className="home-foot faint">
        <div className="home-theme">
          <ThemePicker />
        </div>
        Card data &amp; images courtesy of <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a>. Cubes from{" "}
        <a href="https://cubecobra.com" target="_blank" rel="noreferrer">CubeCobra</a>. HyperDraft is unofficial Fan Content permitted under the Wizards of the Coast Fan
        Content Policy; not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
      </footer>
    </div>
  );
}

type Invite = ReturnType<typeof useInvite>;

/**
 * The saved invite code, if any, and what the server says about it (quota, its rooms). Starts from the last answer
 * this browser saw, so the quota line and "Your rooms" don't pop in once the fresh one arrives.
 */
function useInvite() {
  const toast = useStore((s) => s.toast);
  const [key, setKey] = useState(loadInvite);
  const [info, setInfo] = useState(() => loadInviteInfo(key));

  const refresh = useCallback(
    async (k: string) => {
      try {
        setInfo(await fetchInvite(k));
        return true;
      } catch (e) {
        if (e instanceof InviteError && e.status === 401) {
          forgetInvite();
          setKey(null);
          setInfo(null);
        }
        toast(e instanceof Error ? e.message : "Could not load your invite.", "error");
        return false;
      }
    },
    [toast],
  );

  useEffect(() => {
    if (key) void refresh(key);
  }, [key, refresh]);

  const forget = () => {
    forgetInvite();
    setKey(null);
    setInfo(null);
  };

  const remove = async (room: RoomEntry) => {
    if (!key || !confirm(`Delete room ${room.code}? Everything in it (draft, decks, table) is gone for good.`)) return;
    try {
      await deleteRoom(key, room.code);
      forgetRoom(room.code);
      toast(`Deleted room ${room.code}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete the room.", "error");
    }
    void refresh(key);
  };

  return { key, setKey, info, refresh, forget, remove };
}

/**
 * Hosting online rooms: with an invite code, the invite's rooms. Without one, a public room from
 * the shared pool, when the server has public rooms switched on. "Your rooms" sits beside the panel.
 */
function HostSection({ needName, invite }: { needName: () => boolean; invite: Invite }) {
  const toast = useStore((s) => s.toast);
  const { key, setKey, info, refresh } = invite;
  const [entering, setEntering] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submitKey = async () => {
    const k = draft.trim();
    if (!k) return;
    setBusy(true);
    if (await refresh(k)) {
      saveInvite(k);
      setKey(k);
      setEntering(false);
      setDraft("");
    }
    setBusy(false);
  };

  const host = async () => {
    if (!key || needName()) return;
    setBusy(true);
    try {
      const code = await createRoom(key);
      rememberRoom(code, { hosted: true });
      navigate(`/r/${code}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create a room.", "error");
      void refresh(key);
    } finally {
      setBusy(false);
    }
  };

  if (!key) {
    const inviteEntry = entering ? (
      <div className="row">
        <input
          className="input"
          autoFocus
          value={draft}
          placeholder="Invite code"
          aria-label="Invite code"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitKey();
            if (e.key === "Escape") setEntering(false);
          }}
        />
        <button className="btn" disabled={busy || !draft.trim()} onClick={submitKey}>
          Save
        </button>
      </div>
    ) : (
      <button className="btn ghost small home-invite-link" onClick={() => setEntering(true)}>
        Have an invite code? Host your own online games
      </button>
    );
    return (
      <>
        <PublicHost needName={needName} />
        {inviteEntry}
      </>
    );
  }

  const q = info?.quota;
  const blocker = !q
    ? null
    : q.rooms >= q.maxRooms
      ? `All ${q.maxRooms} room slots are used. Delete a room below to host a new one.`
      : q.nextSlotAt !== null
        ? `Daily limit reached (${q.perWindow} rooms per 24h). Next slot opens ${new Date(q.nextSlotAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
        : null;
  return (
    <>
      <button className="btn big" disabled={busy || !info || !!blocker} onClick={host}>
        <Icon name="sparkle" /> Host an online game
      </button>
      {blocker && <p className="pill warn home-blocker">{blocker}</p>}
      {info && q ? (
        <p className="faint small-print home-note">
          Invite <b>{info.label}</b> · {q.createdInWindow}/{q.perWindow} rooms in 24h · {q.rooms}/{q.maxRooms} saved ·{" "}
          <button className="link-btn" onClick={invite.forget}>
            forget invite
          </button>
        </p>
      ) : (
        <p className="faint small-print home-note">
          Checking your invite… ·{" "}
          <button className="link-btn" onClick={invite.forget}>
            forget invite
          </button>
        </p>
      )}
    </>
  );
}

/**
 * Hosting from the public pool: a few shared slots, rooms that close on their own. Until the server answers, it lays
 * out the last answer this browser saw (or, the first time, an open pool) with hosting held off, so the panel keeps
 * its shape when the answer lands.
 */
function PublicHost({ needName }: { needName: () => boolean }) {
  const toast = useStore((s) => s.toast);
  const [status, setStatus] = useState<PublicStatus | null>(loadPublicStatus);
  const [fresh, setFresh] = useState(false);
  const [mine, setMine] = useState(loadMine);
  const [busy, setBusy] = useState(false);
  const turnstile = useTurnstile(status?.enabled ? (status.turnstileSiteKey ?? null) : null);

  const refresh = useCallback(async () => {
    setMine(loadMine());
    try {
      setStatus(await fetchPublicStatus());
    } catch {
      setStatus({ enabled: false });
    }
    setFresh(true);
  }, []);

  // Slots free up while you wait: look again whenever the tab comes back into focus.
  useEffect(() => {
    void refresh();
    const onFocus = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  const known = status ?? { enabled: true };
  if (!known.enabled) return null;
  const { slots = PUBLIC_LIMITS.slots, used = 0, nextFreeAt, nextRoomMs = PUBLIC_LIMITS.ttlMs, reopensAt, idleMs = PUBLIC_LIMITS.idleMs } = known;
  const needsCheck = !!known.turnstileSiteKey;
  // Always mounted (the widget renders into it once), hidden while there's nothing to host.
  const check = needsCheck && <div ref={turnstile.ref} className="turnstile-slot" hidden={!!mine || !!reopensAt} />;

  const host = async () => {
    if (needName()) return;
    setBusy(true);
    try {
      const room = await createPublicRoom(turnstile.token);
      rememberMine(room.code, room.expiresAt);
      navigate(`/r/${room.code}`);
    } catch (e) {
      // Already hosting one (maybe from another browser on this network): go there.
      if (e instanceof PublicRoomError && e.code && e.expiresAt) {
        rememberMine(e.code, e.expiresAt);
        navigate(`/r/${e.code}`);
      } else toast(e instanceof Error ? e.message : "Could not create a room.", "error");
      void refresh();
    } finally {
      // Turnstile passes are single-use.
      if (needsCheck) turnstile.reset();
      setBusy(false);
    }
  };

  if (mine) {
    return (
      <div className="public-host">
        <p className="pill ok home-blocker">
          Your public room {mine.code} is open until {clockTime(mine.expiresAt)}, unless it sat empty for {durationLabel(idleMs)}.
        </p>
        <button className="btn big" onClick={() => !needName() && navigate(`/r/${mine.code}`)}>
          <Icon name="play" /> Back to room {mine.code}
        </button>
        {check}
      </div>
    );
  }

  if (reopensAt) {
    return (
      <div className="public-host">
        <p className="pill warn home-blocker">
          Today's public table time is all booked. Check back later (rooms that close early give time back), or at the latest {clockTime(reopensAt)}. Solo mode is always open.
        </p>
        {check}
      </div>
    );
  }

  // A full pool may have a room that just closed: the button asks the server to check again.
  const full = nextFreeAt != null;
  return (
    <div className="public-host">
      <button className="btn big" disabled={busy || !fresh || (needsCheck && !turnstile.token)} onClick={host}>
        <Icon name="sparkle" /> {full ? "Check for a free public table" : "Host a public room"}
      </button>
      {full ? (
        <p className="pill warn home-blocker">
          All {slots} public tables are in use. One frees up by {clockTime(nextFreeAt)} at the latest, sooner if a table goes idle. Solo mode is always open.
        </p>
      ) : (
        <p className="faint small-print home-note">
          No invite needed. Open until about {clockTime(Date.now() + nextRoomMs)} ({durationLabel(nextRoomMs)}), or until nobody's been in it for {durationLabel(idleMs)} ·{" "}
          {fresh ? `${slots - used} of ${slots} tables free` : "checking for free tables…"}
        </p>
      )}
      {check}
      {needsCheck && turnstile.failed && <p className="faint small-print home-note">Couldn't run the quick bot check. Reload the page to try again.</p>}
    </div>
  );
}

const PHASE_LABELS: Record<RoomRecord["phase"], string> = {
  lobby: "Lobby",
  drafting: "Drafting",
  deckbuilding: "Deckbuilding",
  playing: "Playing",
};

/**
 * Rooms to go back to: the invite's rooms (from the server, so on any device) and the rooms this
 * browser has hosted or joined. Only an invite's own rooms can be deleted; the rest can only be
 * taken off this list.
 */
function YourRooms({ ledger, onDelete }: { ledger: RoomRecord[]; onDelete?: (r: RoomEntry) => void }) {
  // Read fresh each render (it's a few entries): a delete elsewhere on Home also forgets the room.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const rooms = mergeRooms(ledger, loadRecent());
  if (rooms.length === 0) return null;

  const hide = (r: RoomEntry) => {
    forgetRoom(r.code);
    rerender();
  };

  return (
    <section className="panel home-rooms" aria-labelledby="home-rooms-label">
      <div className="label" id="home-rooms-label">
        Your rooms
      </div>
      <ul>
        {rooms.map((r) => (
          <li key={r.code} className="my-room">
            <button className="my-room-main" onClick={() => navigate(`/r/${r.code}`)} title={`Open room ${r.code}`}>
              <span className="my-room-top">
                <b className="my-room-code">{r.code}</b>
                <span
                  className={`pill room-role ${r.role}`}
                  title={r.role === "hosted" ? (r.onInvite ? "Created with your invite" : "Created from this browser") : "Someone else's room you joined"}
                >
                  {r.role === "hosted" ? "Hosted" : "Joined"}
                </span>
                <span className="pill">{PHASE_LABELS[r.phase]}</span>
                <span className="spacer" />
                <span className="faint" title={r.createdAt ? `Created ${new Date(r.createdAt).toLocaleString()}` : undefined}>
                  {r.onInvite ? "active" : "visited"} {timeAgo(r.activeAt)}
                </span>
              </span>
              <span className="muted my-room-detail">
                {r.players.length > 0 ? r.players.join(", ") : "No players yet"}
                {r.bots > 0 && ` + ${r.bots} bot${r.bots === 1 ? "" : "s"}`}
              </span>
              <span className="faint my-room-detail">
                {r.cubeName ? `${r.cubeName} · ${r.cardCount} cards` : "No cube yet"}
                {r.expiresAt ? ` · public, closes ${clockTime(r.expiresAt)}` : r.createdAt ? ` · created ${new Date(r.createdAt).toLocaleDateString()}` : ""}
              </span>
            </button>
            {r.onInvite && onDelete ? (
              <button className="btn ghost small icon-only" title="Delete room for everyone" aria-label={`Delete room ${r.code}`} onClick={() => onDelete(r)}>
                <Icon name="trash" />
              </button>
            ) : (
              <button className="btn ghost small icon-only" title="Remove from this list (the room stays open)" aria-label={`Remove room ${r.code} from this list`} onClick={() => hide(r)}>
                <Icon name="x" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function timeAgo(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
