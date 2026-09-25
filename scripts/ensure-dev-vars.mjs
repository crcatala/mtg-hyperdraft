// Creates .dev.vars from .dev.vars.example on first `npm run dev`, so local online rooms work
// without any setup. Never overwrites an existing .dev.vars.
import { copyFileSync, existsSync } from "node:fs";

if (!existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log("Created .dev.vars from .dev.vars.example (local invite code: dev-invite-key).");
}
