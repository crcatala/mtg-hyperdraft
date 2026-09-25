// Connects to a room and shows the screen for its current phase.

import { useEffect, useState } from "react";
import { connect, disconnect } from "../net";
import { loadIdentity, loadName, saveName } from "../identity";
import { navigate } from "../router";
import { useStore } from "../store";
import { Lobby } from "./Lobby";
import { Draft } from "./Draft";
import { Deckbuilder } from "./Deckbuilder";
import { TableScreen } from "../table/TableScreen";

export function RoomScreen({ code }: { code: string }) {
  const [named, setNamed] = useState(() => !!loadName() || !!loadIdentity(code));
  const status = useStore((s) => s.status);
  const fatal = useStore((s) => s.fatal);
  const phase = useStore((s) => s.view?.phase);
  const claimSeats = useStore((s) => s.claimSeats);

  useEffect(() => {
    if (!named) return;
    connect(code);
    return () => disconnect();
  }, [code, named]);

  if (!named) return <NamePrompt code={code} onDone={() => setNamed(true)} />;

  if (status === "claim") return <SeatPicker code={code} seats={claimSeats} />;

  if (status === "failed") {
    return (
      <div className="screen">
        <div className="center-stage">
          <div className="panel notice">
            <h2 className="brand">Can't join {code}</h2>
            <p className="muted">{fatal}</p>
            <button className="btn primary" onClick={() => navigate("/")}>
              Back home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!phase) {
    return (
      <div className="screen">
        <div className="center-stage">
          <div className="loading-sigil" />
          <p className="muted">Connecting to lobby {code}…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <PhaseScreen />
      {status !== "open" && <div className="reconnect-banner">Connection lost — reconnecting…</div>}
    </>
  );
}

/** The screen for the room's current phase. Shared by online rooms and solo mode. */
export function PhaseScreen() {
  const phase = useStore((s) => s.view?.phase);
  return (
    <>
      {phase === "lobby" && <Lobby />}
      {phase === "drafting" && <Draft />}
      {phase === "deckbuilding" && <Deckbuilder />}
      {phase === "playing" && <TableScreen />}
    </>
  );
}

/** Rejoining a started game without this browser's seat secret: pick which player you are. */
function SeatPicker({ code, seats }: { code: string; seats: { id: string; name: string }[] }) {
  return (
    <div className="screen">
      <div className="center-stage">
        <div className="panel notice">
          <h2 className="brand">Rejoin {code}</h2>
          <p className="muted">This game has already started. If you were playing on another device or browser, pick your seat to continue.</p>
          <div className="seat-choices">
            {seats.map((s) => (
              <button key={s.id} className="btn primary" onClick={() => connect(code, s.id)}>
                I'm {s.name}
              </button>
            ))}
          </div>
          <button className="btn ghost small" onClick={() => navigate("/")}>
            Back home
          </button>
        </div>
      </div>
    </div>
  );
}

function NamePrompt({ code, onDone }: { code: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    saveName(name.trim());
    onDone();
  };
  return (
    <div className="screen">
      <div className="center-stage">
        <div className="panel notice">
          <h2 className="brand">Join lobby {code}</h2>
          <label className="label" htmlFor="jn">
            Your name
          </label>
          <input id="jn" className="input" autoFocus maxLength={24} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
