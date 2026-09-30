import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInviteFromUrl } from "./invite";
import { initTheme, installThemeShortcut } from "./theme";
import "./styles.css";
import "./screens.css";
import "./themes/gamenight.css";
import "./themes/signal.css";

captureInviteFromUrl();
initTheme();
installThemeShortcut();

createRoot(document.getElementById("root")!).render(<App />);
