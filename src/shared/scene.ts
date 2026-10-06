// The look of the 3D table: which table everyone plays on and what surrounds it. Purely cosmetic and
// shared by the whole room (anyone at the table can change it, for everyone). It never moves a card,
// a mat or a companion: every table is drawn around the same play area (tableRadius in tableLayout.ts).

export const TABLE_STYLES = [
  { id: "felt", label: "Classic felt", blurb: "Round walnut table, green baize, padded leather rail." },
  { id: "runestone", label: "Runestone", blurb: "Twelve-sided slate slab ringed with glowing runes." },
  { id: "oak", label: "Oak & brass", blurb: "Square oak card table with a leather inlay and candles." },
] as const;
export type TableStyleId = (typeof TABLE_STYLES)[number]["id"];

export const ENVIRONMENTS = [
  { id: "tavern", label: "Tavern hearth", blurb: "A crackling fire, barrels and a sleeping cat." },
  { id: "library", label: "Arcane library", blurb: "Towering shelves, floating books and candles." },
  { id: "grove", label: "Moonlit grove", blurb: "Standing stones, fireflies and swaying trees." },
] as const;
export type EnvironmentId = (typeof ENVIRONMENTS)[number]["id"];

export interface SceneChoice {
  table: TableStyleId;
  env: EnvironmentId;
}

export const DEFAULT_SCENE: SceneChoice = { table: "felt", env: "tavern" };

export const TABLE_STYLE_IDS = TABLE_STYLES.map((t) => t.id) as [TableStyleId, ...TableStyleId[]];
export const ENVIRONMENT_IDS = ENVIRONMENTS.map((e) => e.id) as [EnvironmentId, ...EnvironmentId[]];

export const isTableStyle = (v: unknown): v is TableStyleId => TABLE_STYLES.some((t) => t.id === v);
export const isEnvironment = (v: unknown): v is EnvironmentId => ENVIRONMENTS.some((e) => e.id === v);

/** A stored choice with anything missing or retired (rooms saved before this existed) set to the default. */
export function resolveScene(saved: Partial<SceneChoice> | null | undefined): SceneChoice {
  return {
    table: isTableStyle(saved?.table) ? saved.table : DEFAULT_SCENE.table,
    env: isEnvironment(saved?.env) ? saved.env : DEFAULT_SCENE.env,
  };
}

export const tableStyleLabel = (id: TableStyleId) => TABLE_STYLES.find((t) => t.id === id)!.label;
export const environmentLabel = (id: EnvironmentId) => ENVIRONMENTS.find((e) => e.id === id)!.label;
