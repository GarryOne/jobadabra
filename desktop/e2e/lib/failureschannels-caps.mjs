// Generated state-wait hang caps for failureschannels; never a speed assertion.
// Job: wait on state
// tools/e2e-step-timings.mjs: 9 main runs, 9/9 calm shard-runs.
// Main run IDs: 40610690663, 40617153757, 40650235925, 40796899545, 40799225090, 40802551247, 40836904987, 40960750830, 40975522762.
// Generated with --dir failureschannels via measure() and capsModule(report, {sharedCaps, sharedImport: "./applyflows-caps.mjs"}).
// Sparse shared steps use applyflows main measurements (see that module for provenance).
// 3 x calm p95, rounded up to 5 s, with a 30 s floor; at least 5 calm samples.
import {hangCaps as sharedCaps} from "./applyflows-caps.mjs";
export const hangCaps = {
  "Google access revoked: the Gmail check says so in words (connect Google again), never a plain Completed, never Google's raw answer": 45, // n=9, p95=13.6 s
  "nothing was queued to report to the product": 30, // n=9, p95=0.2 s
  "Telegram refuses the digest (the bot was blocked): the run says so in words, never a plain Completed, nothing left Running": 105, // n=9, p95=33.7 s
  "the app is quiet before the first task: no schedule, no first search, its history read": 30, // n=9, p95=9.2 s
  "the app is seeded as a set-up install from the existing workspace": sharedCaps["the app is seeded as a set-up install from the existing workspace"], // n=4; shared step's measured cap
  "the app is set up on this Mac's store with the applicant's strategy": 30, // n=5, p95=2.6 s
  "the Gmail check reads the inbox through Google and ends in words, with nothing left Running": 180, // n=9, p95=58.5 s
  "the Notion stand-in answered every request the app made": sharedCaps["the Notion stand-in answered every request the app made"], // n=4; shared step's measured cap
  "this suite starts with no job rows in its store's Job Matches": 30, // n=9, p95=0.4 s
  "this suite starts with no run rows in its store": 30, // n=9, p95=4.4 s
  "with Telegram connected, a Jobs check sends one readable digest to the person's chat": 85, // n=9, p95=27.6 s
};
