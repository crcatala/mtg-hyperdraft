// Snapshots the bundled preset cubes into public/presets/<id>.json using the same import pipeline
// the game uses (CubeCobra → Scryfall), so the result is exactly what a live import would produce.
//   npm run presets:build
import { mkdirSync, writeFileSync } from "node:fs";
import { runnerImport } from "vite";

const opts = { configFile: false, logLevel: "error" };
const { module: presets } = await runnerImport("/src/shared/presets.ts", opts);
const { module: importer } = await runnerImport("/src/shared/importCube.ts", opts);

mkdirSync("public/presets", { recursive: true });
for (const preset of presets.PRESET_CUBES) {
  console.log(`${preset.name}: importing ${preset.from}`);
  const result = await importer.importCube(preset.from, (url, init) => fetch(url, init), (m) => console.log(`  ${m}`));
  if (result.pool.length !== preset.cards) {
    console.warn(`  ! ${preset.name} now has ${result.pool.length} cards; update PRESET_CUBES in src/shared/presets.ts.`);
  }
  if (result.notFound.length) console.warn(`  ! not found on Scryfall: ${result.notFound.join(", ")}`);
  const snapshot = { ...result, source: `${result.source} · bundled snapshot ${new Date().toISOString().slice(0, 10)}` };
  const path = `public/presets/${preset.id}.json`;
  writeFileSync(path, JSON.stringify(snapshot));
  console.log(`  wrote ${path} (${Math.round(JSON.stringify(snapshot).length / 1024)} KB, ${result.cards.length} unique cards)`);
}
