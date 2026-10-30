// Generated state-wait hang caps for interactions; never a speed assertion.
// Job: wait on state
// tools/e2e-step-timings.mjs: 9 main runs, 9/9 calm shard-runs.
// Main run IDs: 40650235925, 40746737212, 40768828567, 40796899545, 40799225090, 40802551247, 40836904987, 40960750830, 40975522762.
// Generated with --dir interactions via measure() and capsModule(report, {sharedCaps, sharedImport: "./applyflows-caps.mjs"}).
// Sparse shared steps use applyflows main measurements (see that module for provenance).
// 3 x calm p95, rounded up to 5 s, with a 30 s floor; at least 5 calm samples.
import {hangCaps as sharedCaps} from "./applyflows-caps.mjs";
export const hangCaps = {
  "actions: every safe control does something": 40, // n=9, p95=12.3 s
  "actions: stays still once it has loaded": 30, // n=9, p95=8.2 s
  "calendar: every safe control does something": 45, // n=9, p95=14.9 s
  "calendar: stays still once it has loaded": 35, // n=9, p95=11.2 s
  "every page at four window sizes and in both themes: nothing is cut off, unreachable or broken (no screenshots, no AI)": 220, // n=8, p95=71.8 s
  "focus: every safe control does something": 200, // n=9, p95=65.6 s
  "focus: stays still once it has loaded": 50, // n=9, p95=15.1 s
  "interaction findings are written": 30, // n=8, p95=0.4 s
  "interviews: every safe control does something": 80, // n=9, p95=25.6 s
  "interviews: stays still once it has loaded": 90, // n=9, p95=28.5 s
  "jobs: every safe control does something": 160, // n=9, p95=52.3 s
  "jobs: stays still once it has loaded": 30, // n=9, p95=8.7 s
  "nothing was queued to report to the product": 30, // n=8, p95=0.3 s
  "sessions: every safe control does something": 30, // n=9, p95=4.2 s
  "sessions: stays still once it has loaded": 30, // n=9, p95=8.4 s
  "settings: every safe control does something": 65, // n=9, p95=21.6 s
  "settings: stays still once it has loaded": 30, // n=9, p95=9.9 s
  "strategy: every safe control does something": 90, // n=9, p95=29 s
  "strategy: stays still once it has loaded": 90, // n=9, p95=29.4 s
  "the app is seeded as a set-up install from the existing workspace": 55, // n=5, p95=16.9 s
  "the app is set up on this Mac's store with the applicant's strategy": sharedCaps["the app is set up on this Mac's store with the applicant's strategy"], // n=4; shared step's measured cap
  "the detectors catch the bugs planted for them (recall)": 85, // n=9, p95=27.2 s
  "the icon rail: every badge and dot sits inside its button, clear of the icon": 30, // n=8, p95=0.7 s
  "the narrowest window: the sidebar is an icon rail and every page still fits": 45, // n=9, p95=14.1 s
  "the Notion stand-in answered every request the app made": sharedCaps["the Notion stand-in answered every request the app made"], // n=4; shared step's measured cap
};
