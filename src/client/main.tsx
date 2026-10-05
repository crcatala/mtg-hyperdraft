import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInviteFromUrl } from "./invite";
import { initTheme, installThemeShortcut } from "./theme";
import { installSfxWarmUp } from "./sfx";
import { initSoundPack } from "./soundPacks";
import { initMusic } from "./music";
import { initVolumes } from "./volume";
import "./styles.css";
import "./screens.css";
import "./persona.css";
import "./themes/gamenight.css";
import "./themes/signal.css";

captureInviteFromUrl();
initTheme();
installThemeShortcut();
initSoundPack();
installSfxWarmUp();
initVolumes();
initMusic();

createRoot(document.getElementById("root")!).render(<App />);
