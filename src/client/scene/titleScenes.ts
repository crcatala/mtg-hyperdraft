// Which environment and table the title screen shows under each UI theme, so the backdrop matches the menus:
// Game Night is the oak table by the tavern hearth, Arcane the runestone in the library, Signal the felt table in
// the moonlit grove. Between them, every environment and table appears once.

import type { ThemeId } from "../theme";
import type { EnvironmentId, TableStyleId } from "../../shared/scene";

export const TITLE_SCENES: Record<ThemeId, { env: EnvironmentId; table: TableStyleId }> = {
  gamenight: { env: "tavern", table: "oak" },
  arcane: { env: "library", table: "runestone" },
  signal: { env: "grove", table: "felt" },
};
