// Generated state-wait hang caps for settings; never a speed assertion.
// Job: wait on state
// tools/e2e-step-timings.mjs: 10 main runs, 9/10 calm shard-runs.
// Main run IDs: 40135785331, 40152010902, 40252278499, 40274183649, 40428980247, 40434672283, 40589724303, 40610690663, 40799225090, 40802551247.
// Generated with measure(dir, "settings") and capsModule(report, {sharedCaps, sharedImport: "./applyflows-caps.mjs"}).
// Sparse shared steps use applyflows main measurements (see that module for provenance).
// 3 x calm p95, rounded up to 5 s, with a 30 s floor; at least 5 calm samples.
import {hangCaps as sharedCaps} from "./applyflows-caps.mjs";
export const hangCaps = {
  "⌘K opens the palette: every page is listed, a typed command opens its page, Esc closes it": 30, // n=9, p95=2.4 s
  "Automatic backup: a due backup runs once at start and once on the weekly tick": 65, // n=9, p95=20.2 s
  "Automatic backup: Back up now writes a backup with no keys in its folder, and View backups opens it": 30, // n=9, p95=1.7 s
  "Automatic backup: the backup file, imported after a reset, brings this computer back as it was": 55, // n=9, p95=17.9 s
  "every Settings section renders": 70, // n=9, p95=22 s
  "nothing was queued to report to the product": 30, // n=9, p95=0.3 s
  "Settings render without layout problems": 30, // n=9, p95=0.4 s
  "the AI engine panel is coherent with each engine chosen (a key is saved in both)": 30, // n=9, p95=2.7 s
  "the app is seeded as a set-up install from the existing workspace": sharedCaps["the app is seeded as a set-up install from the existing workspace"], // n=2; shared step's measured cap
  "the app is set up on this Mac's store with the applicant's strategy": 35, // n=7, p95=11 s
  "the CV check reads real PDFs: a plain CV passes, each known problem is found, a picture of a CV fails": 30, // n=9, p95=4.2 s
  "the Notion stand-in answered every request the app made": sharedCaps["the Notion stand-in answered every request the app made"], // n=2; shared step's measured cap
  "Your data: export with keys, reset, then import from the setup brings this computer back as it was": 35, // n=9, p95=11.5 s
};
