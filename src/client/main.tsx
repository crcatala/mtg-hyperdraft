import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInviteFromUrl } from "./invite";
import { applyTheme } from "./theme";
import "./styles.css";
import "./screens.css";
import "./themes/folio.css";
import "./themes/gamenight.css";
import "./themes/signal.css";

captureInviteFromUrl();
applyTheme();

createRoot(document.getElementById("root")!).render(<App />);
