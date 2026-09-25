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

  useEffect(() => {
    if (!named) return;
    connect(code);
    return () => disconnect();
  }, [code, named]);

  if (!named) return <NamePrompt code={code} onDone={() => setNamed(true)} />;

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
      {phase === "lobby" && <Lobby />}
      {phase === "drafting" && <Draft />}
      {phase === "deckbuilding" && <Deckbuilder />}
      {phase === "playing" && <TableScreen />}
      {status !== "open" && <div className="reconnect-banner">Connection lost — reconnecting…</div>}
    </>
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
