// Generated state-wait hang caps for jobs; never a speed assertion.
// Job: wait on state
// tools/e2e-step-timings.mjs: 9 main runs, 9/9 calm shard-runs.
// Main run IDs: 40610690663, 40617153757, 40650235925, 40796899545, 40799225090, 40802551247, 40836904987, 40960750830, 40975522762.
// Generated with --dir jobs via measure() and capsModule(report, {sharedCaps, sharedImport: "./applyflows-caps.mjs"}).
// Sparse shared steps use applyflows main measurements (see that module for provenance).
// 3 x calm p95, rounded up to 5 s, with a 30 s floor; at least 5 calm samples.
import {hangCaps as sharedCaps} from "./applyflows-caps.mjs";
export const hangCaps = {
  "a jobs check reads the fixture feeds, drops the wrong roles and scores the matching jobs": 395, // n=8, p95=130.5 s
  "a scored job without a kit shows the Apply button, never Prepare, and \"Prepare only\" in its ⋯ menu": 30, // n=8, p95=2.9 s
  "a slow Jobs check keeps showing that it is working, and ends cleanly": 495, // n=8, p95=163.9 s
  "every scored job in the Jobs list is its Job Matches record, with the same score, and none is missing": 335, // n=8, p95=110.8 s
  "Find new employers probes the seed company and lists it in the store (Employers & Sources)": 55, // n=8, p95=16.9 s
  "nothing was queued to report to the product": 30, // n=8, p95=0.2 s
  "the app is seeded as a set-up install from the existing workspace": sharedCaps["the app is seeded as a set-up install from the existing workspace"], // n=4; shared step's measured cap
  "the app is set up on this Mac's store with the applicant's strategy": 30, // n=5, p95=4.7 s
  "the app's next start links this workspace's Search settings page (so the check looks for this person's roles and places)": 90, // n=4; fewer than 5 calm samples, no shared cap; 30 s floor x 3
  "the check looks for this person's roles and places (this Mac's config, no Search settings page)": 30, // n=5, p95=0.4 s
  "the Notion stand-in answered every request the app made": sharedCaps["the Notion stand-in answered every request the app made"], // n=4; shared step's measured cap
  "the pages of this suite render without layout problems": 35, // n=8, p95=10.9 s
  "this suite starts with no jobs and no runs in its Notion page": 30, // n=9, p95=3.7 s
};
