// Snapshots the bundled preset cubes into public/presets/<id>.json using the same import pipeline
// the game uses (CubeCobra → Scryfall), so the result is exactly what a live import would produce.
// The snapshots are gitignored: they're generated before build and deploy, not committed.
//   npm run presets:build                 refresh every preset (what predeploy runs; a failure stops the deploy)
//   node scripts/build-presets.mjs --if-missing              only fetch presets whose file is absent (prebuild)
//   node scripts/build-presets.mjs --if-missing --optional   also warn instead of failing when offline (predev)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { runnerImport } from "vite";

const args = new Set(process.argv.slice(2));
const ifMissing = args.has("--if-missing");
const optional = args.has("--optional");

const opts = { configFile: false, logLevel: "error" };
const { module: presets } = await runnerImport("/src/shared/presets.ts", opts);
const { module: importer } = await runnerImport("/src/shared/importCube.ts", opts);

mkdirSync("public/presets", { recursive: true });
for (const preset of presets.PRESET_CUBES) {
  const path = `public/presets/${preset.id}.json`;
  if (ifMissing && existsSync(path)) {
    console.log(`${preset.name}: ${path} already built, skipping`);
    continue;
  }
  console.log(`${preset.name}: importing ${preset.from}`);
  try {
    const result = await importer.importCube(preset.from, (url, init) => fetch(url, init), (m) => console.log(`  ${m}`));
    if (result.pool.length !== preset.cards) {
      console.warn(`  ! ${preset.name} now has ${result.pool.length} cards; update PRESET_CUBES in src/shared/presets.ts.`);
    }
    if (result.notFound.length) console.warn(`  ! not found on Scryfall: ${result.notFound.join(", ")}`);
    const snapshot = { ...result, source: `${result.source} · bundled snapshot ${new Date().toISOString().slice(0, 10)}` };
    writeFileSync(path, JSON.stringify(snapshot));
    console.log(`  wrote ${path} (${Math.round(JSON.stringify(snapshot).length / 1024)} KB, ${result.cards.length} unique cards)`);
  } catch (err) {
    if (!optional) throw err;
    console.warn(`  ! ${preset.name} not built (${err instanceof Error ? err.message : err}). Starter cube is unavailable until the next build.`);
  }
}
