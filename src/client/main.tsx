import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInviteFromUrl } from "./invite";
import { applyTheme, installThemeShortcut } from "./theme";
import "./styles.css";
import "./screens.css";
import "./themes/gamenight.css";
import "./themes/signal.css";

captureInviteFromUrl();
applyTheme();
installThemeShortcut();

createRoot(document.getElementById("root")!).render(<App />);
