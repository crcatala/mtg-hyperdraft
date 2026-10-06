import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInviteFromUrl } from "./invite";
import { initTheme, installThemeShortcut } from "./theme";
import { installSfxWarmUp } from "./sfx";
import { initSoundPack } from "./soundPacks";
import { initMusic } from "./music";
import { initVolumes } from "./volume";
import { initCompanionPrefs } from "./companionPrefs";
import { initDebugAccess } from "./debugAccess";
import "./styles.css";
import "./screens.css";
import "./persona.css";
import "./themes/gamenight.css";
import "./themes/signal.css";

captureInviteFromUrl();
initDebugAccess();
initTheme();
installThemeShortcut();
initSoundPack();
installSfxWarmUp();
initVolumes();
initCompanionPrefs();
initMusic();

createRoot(document.getElementById("root")!).render(<App />);
