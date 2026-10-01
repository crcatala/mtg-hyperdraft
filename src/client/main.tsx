import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInviteFromUrl } from "./invite";
import { initTheme, installThemeShortcut } from "./theme";
import { installSfxWarmUp } from "./sfx";
import { initSoundChoice } from "./soundPacks";
import "./styles.css";
import "./screens.css";
import "./themes/gamenight.css";
import "./themes/signal.css";

captureInviteFromUrl();
initTheme();
installThemeShortcut();
initSoundChoice();
installSfxWarmUp();

createRoot(document.getElementById("root")!).render(<App />);
