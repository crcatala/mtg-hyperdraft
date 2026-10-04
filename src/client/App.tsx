import { useEffect } from "react";
import { roomCodeFromPath, usePath } from "./router";
import { Home } from "./screens/Home";
import { RoomScreen } from "./screens/RoomScreen";
import { SoloScreen } from "./screens/SoloScreen";
import { IconGallery } from "./screens/IconGallery";
import { SoundStudio } from "./screens/SoundStudio";
import { Toasts } from "./components/Toasts";
import { ContextMenu } from "./components/ContextMenu";
import { MusicPlayer } from "./components/MusicPlayer";
import { SettingsDialog } from "./components/SettingsDialog";
import { DebugConsole } from "./debug/DebugConsole";
import { useStore } from "./store";

export function App() {
  const path = usePath();
  const code = roomCodeFromPath(path);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        const s = useStore.getState();
        s.setDebug({ open: !s.debug.open });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {path === "/solo" ? <SoloScreen /> : path === "/dev/icons" ? <IconGallery /> : path === "/dev/sound-studio" ? <SoundStudio /> : code ? <RoomScreen code={code} /> : <Home />}
      <Toasts />
      <ContextMenu />
      <MusicPlayer />
      <SettingsDialog />
      <DebugConsole />
    </>
  );
}
