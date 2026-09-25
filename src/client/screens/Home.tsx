import { useState } from "react";
import { createRoom, roomExists } from "../net";
import { loadName, saveName } from "../identity";
import { navigate } from "../router";
import { useStore } from "../store";

export function Home() {
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);

  const create = async () => {
    if (!name.trim()) return toast("Pick a name first.", "error");
    saveName(name.trim());
    setBusy(true);
    try {
      navigate(`/r/${await createRoom()}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create a lobby.", "error");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    const c = code.trim().toUpperCase();
    if (!name.trim()) return toast("Pick a name first.", "error");
    if (!/^[A-Z0-9]{4,8}$/.test(c)) return toast("Room codes are 6 letters/numbers.", "error");
    saveName(name.trim());
    setBusy(true);
    try {
      if (await roomExists(c)) navigate(`/r/${c}`);
      else toast(`No lobby with code ${c}.`, "error");
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
            <input
              id="name"
              className="input"
              value={name}
              maxLength={24}
              placeholder="e.g. Chandra"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              autoFocus
            />
            <button className="btn primary big" disabled={busy} onClick={create}>
              ✦ Create a lobby
            </button>
            <div className="home-or">
              <span>or join friends</span>
            </div>
            <div className="row">
              <input
                className="input code-input"
                value={code}
                maxLength={8}
                placeholder="CODE"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && join()}
              />
              <button className="btn violet" disabled={busy} onClick={join}>
                Join
              </button>
            </div>
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
