import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInviteFromUrl } from "./invite";
import { applyTheme, installThemeShortcut } from "./theme";
import "./styles.css";
import "./screens.css";
import "./themes/gamenight.css";

captureInviteFromUrl();
applyTheme();
installThemeShortcut();

createRoot(document.getElementById("root")!).render(<App />);
