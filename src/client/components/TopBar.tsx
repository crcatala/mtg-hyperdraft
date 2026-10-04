import { useState, type ReactNode } from "react";
import { useStore } from "../store";
import { navigate } from "../router";
import { saveName } from "../identity";
import { copyText } from "../clipboard";
import { Icon } from "./Icon";
import { PublicRoomChip } from "./PublicRoomChip";
import { SettingsButton } from "./SettingsDialog";

export function TopBar({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  const code = useStore((s) => s.view?.code);
  const status = useStore((s) => s.status);
  const mode = useStore((s) => s.mode);
  const toast = useStore((s) => s.toast);

  const copyInvite = async () => {
    if (!code) return;
    const link = `${location.origin}/r/${code}`;
    if (await copyText(link)) toast("Invite link copied — send it to your friends!");
    else toast(`Copy this invite link: ${link}`);
  };

  return (
    <header className="topbar">
      <span className="brand" role="link" style={{ cursor: "pointer" }} onClick={() => navigate("/")} title="Home">
        HyperDraft
      </span>
      {title && <span className="topbar-sep" aria-hidden />}
      {title && <span className="topbar-title">{title}</span>}
      <div className="spacer" />
      {children}
      {/* Solo needs no status; online rooms show the invite code, and the connection only when it's in trouble
          (the reconnect banner covers the rest). */}
      {mode !== "solo" && (
        <>
          <PublicRoomChip />
          {status !== "open" && <span className={`conn ${status}`}>{status}</span>}
          {code && (
            <button className="code-chip" onClick={copyInvite} title="Copy invite link">
              <span className="code-chip-label">Room</span>
              {code}
              <Icon name="copy" />
            </button>
          )}
        </>
      )}
      <SettingsButton />
    </header>
  );
}

export function NameEditor() {
  const me = useStore((s) => s.view?.players.find((p) => p.id === s.view?.you));
  const send = useStore((s) => s.send);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  if (!me) return null;
  if (!editing) {
    return (
      <button
        className="btn ghost small"
        title="Change your name"
        onClick={() => {
          setValue(me.name);
          setEditing(true);
        }}
      >
        {me.name} <Icon name="pencil" />
      </button>
    );
  }
  const commit = () => {
    const name = value.trim();
    if (name && name !== me.name) {
      send({ t: "setName", name });
      saveName(name);
    }
    setEditing(false);
  };
  return (
    <input
      className="input name-edit"
      autoFocus
      maxLength={24}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}
