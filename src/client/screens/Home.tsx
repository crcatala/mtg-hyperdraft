import { useCallback, useEffect, useState } from "react";
import { roomExists } from "../net";
import { loadName, saveName } from "../identity";
import { createRoom, deleteRoom, fetchInvite, forgetInvite, InviteError, loadInvite, saveInvite } from "../invite";
import { navigate } from "../router";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { ROOM_CODE_LENGTH, ROOM_CODE_RE } from "../../shared/roomCode";
import type { InviteInfo, RoomRecord } from "../../shared/invites";

export function Home() {
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);

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
    <div className="screen home">
      <div className="home-fan" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="home-fan-card" style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>
      <div className="center-stage">
        <div className="home-hero">
          <h1 className="brand home-title">HyperDraft</h1>
          <p className="home-tag">Crack packs, draft a cube with up to three friends, build your deck, and battle on a shared 3D table.</p>
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
            <HostSection needName={needName} />
          </div>
        </div>
      </div>
      <footer className="home-foot faint">
        Card data &amp; images courtesy of <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a>. Cubes from{" "}
        <a href="https://cubecobra.com" target="_blank" rel="noreferrer">CubeCobra</a>. HyperDraft is unofficial Fan Content permitted under the Wizards of the Coast Fan
        Content Policy; not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
      </footer>
    </div>
  );
}

/** Hosting online rooms needs an invite code; with one, this also lists the invite's rooms. */
function HostSection({ needName }: { needName: () => boolean }) {
  const toast = useStore((s) => s.toast);
  const [key, setKey] = useState(loadInvite);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [entering, setEntering] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

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
      navigate(`/r/${await createRoom(key)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create a room.", "error");
      void refresh(key);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (room: RoomRecord) => {
    if (!key || !confirm(`Delete room ${room.code}? Everything in it (draft, decks, table) is gone for good.`)) return;
    try {
      await deleteRoom(key, room.code);
      toast(`Deleted room ${room.code}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete the room.", "error");
    }
    void refresh(key);
  };

  if (!key) {
    return entering ? (
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
      {info && q && (
        <p className="faint small-print home-note">
          Invite <b>{info.label}</b> · {q.createdInWindow}/{q.perWindow} rooms in 24h · {q.rooms}/{q.maxRooms} saved ·{" "}
          <button
            className="link-btn"
            onClick={() => {
              forgetInvite();
              setKey(null);
              setInfo(null);
            }}
          >
            forget invite
          </button>
        </p>
      )}
      {info && info.rooms.length > 0 && <MyRooms rooms={info.rooms} onDelete={remove} />}
    </>
  );
}

const PHASE_LABELS: Record<RoomRecord["phase"], string> = {
  lobby: "Lobby",
  drafting: "Drafting",
  deckbuilding: "Deckbuilding",
  playing: "Playing",
};

function MyRooms({ rooms, onDelete }: { rooms: RoomRecord[]; onDelete: (r: RoomRecord) => void }) {
  return (
    <div className="my-rooms">
      <div className="label">My rooms</div>
      <ul>
        {rooms.map((r) => (
          <li key={r.code} className="my-room">
            <button className="my-room-main" onClick={() => navigate(`/r/${r.code}`)} title={`Open room ${r.code}`}>
              <span className="my-room-top">
                <b className="my-room-code">{r.code}</b>
                <span className="pill">{PHASE_LABELS[r.phase]}</span>
                <span className="spacer" />
                <span className="faint" title={`Created ${new Date(r.createdAt).toLocaleString()}`}>
                  active {timeAgo(r.lastActiveAt)}
                </span>
              </span>
              <span className="muted my-room-detail">
                {r.players.length > 0 ? r.players.join(", ") : "No players yet"}
                {r.bots > 0 && ` + ${r.bots} bot${r.bots === 1 ? "" : "s"}`}
              </span>
              <span className="faint my-room-detail">
                {r.cubeName ? `${r.cubeName} · ${r.cardCount} cards` : "No cube yet"} · created {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </button>
            <button className="btn ghost small icon-only" title="Delete room" aria-label={`Delete room ${r.code}`} onClick={() => onDelete(r)}>
              <Icon name="x" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function timeAgo(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
