// Wait for quality's observable states and diagnose hangs with the evidence already on disk.
// Job: wait on state
import fs from 'node:fs';
import path from 'node:path';
import {answersMode} from './ai-answers.mjs';

// Why (29 Oct 2026, qu 3/4): nearest-rank p95 of seven calm green main runs equals their maxima:
// Jobs 42.6 s, whole 54.2 s, setup <= 7 s, all other steps <= 4.8 s. Caps catch hangs, never judge speed.
export const QUALITY_CLOCK = Object.freeze({stateMs: 30000, jobsMs: 127800, suiteMs: 162600});
// Why (30 Oct 2026, qu): RECORD calls live AI, so it shares live state/Jobs allowances and gets an eight-minute journey cap.
const LIVE_QUALITY_CLOCK = Object.freeze({stateMs: 90000, jobsMs: 360000, suiteMs: 480000});

/** Select replay's measured hang caps or live AI allowances; recording always uses live clocks. */
export function qualityClocks(backbone = true, env = process.env) {
  return backbone && answersMode(env) !== 'record' ? QUALITY_CLOCK : LIVE_QUALITY_CLOCK;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Name a hang and keep the evidence already collected by its caller. A cut-off is timing in the runner's words too (lib/runner.mjs withLimit): one verdict, whichever timer fires. */
// Why (31 Oct 2026, Gitar on #2672): the old hang words read as a wrong value here but as timing at the step cap; a cut-off says so in one shape.
export const qualityHang = (label, capMs, evidence) => Object.assign(new Error(
  `HANG: ${label} did not finish within ${capMs / 1000} s (it hung)${evidence ? `\n${evidence}` : ''}`), {name: 'QualityHangError'});

/** Read the existing engine log tail without making any app or network calls. */
export function qualityEvidence(ctx) {
  const file = path.join(ctx.profile, 'logs', 'engine.log');
  return `engine log, last lines:\n    ${fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').slice(-12).join('\n    ') : '(no engine log)'}`;
}

/** Bound even an operation whose read never answers; always release the timer on settlement. */
export function withQualityHang(work, {label, capMs, evidence = () => ''}) {
  let timer;
  const stopped = new Promise((_, reject) => {
    timer = setTimeout(() => reject(qualityHang(label, capMs, evidence())), capMs);
  });
  return Promise.race([Promise.resolve().then(work), stopped]).finally(() => clearTimeout(timer));
}

/** Poll fresh state immediately, then at <= 1 s intervals; a cap throws, never returns partial state. */
export async function waitForQualityState(read, ready, {label, capMs, evidence = () => '', now = Date.now, pause: sleep = pause, tickMs = 250}) {
  const began = now();
  let last, active = true;
  try {
    return await withQualityHang(async () => {
      for (;;) {
        last = await read();
        if (!active) return;
        if (ready(last)) return last;
        const left = capMs - (now() - began);
        if (left <= 0) throw qualityHang(label, capMs, evidence(last));
        await sleep(Math.min(tickMs, 1000, left));
      }
    }, {label, capMs, evidence: () => evidence(last)});
  } finally { active = false; }
}
