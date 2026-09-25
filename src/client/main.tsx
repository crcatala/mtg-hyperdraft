import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInviteFromUrl } from "./invite";
import "./styles.css";
import "./screens.css";

captureInviteFromUrl();

createRoot(document.getElementById("root")!).render(<App />);
