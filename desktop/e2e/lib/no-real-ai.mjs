// Counts the AI calls of a test run that went on to a real model; a suite whose AI is all stand-in ends with a step that fails when any did (strategy, 18 Oct 2026: it reached gpt-6-luna).
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {namesException} from '../../../tools/lanes-check.mjs';
import {NON_BACKBONE} from './suite-shards.mjs';
import {missLine} from './ai-miss-name.mjs';

export const realAiCalls = ctx => (ctx.proxy?.stats.paid || 0) + (ctx.openaiProxy?.stats.paid || 0);

// Throws, naming the count, when a call was paid for.
export function assertNoRealAi(ctx) {
  const paid = realAiCalls(ctx);
  if (paid) throw new Error(`${paid} AI call(s) reached a real model although this suite's stand-in should answer every one (see the "ai-proxy refusal" lines above, or the AI cost lines)`);
}

/** Run the suite's declared AI checks through the captured, unfiltered critical-step runner. */
export async function runAiGuards(suite, ctx, runAlways) {
  // A suite that declares `export const realAi = false` answers every AI call with a stand-in: one that reached a real model fails the run (test/suite-ai-mode.test.mjs).
  if (suite.realAi === false) await runAlways('no AI call of this suite reached a real model: the stand-in answered or refused every one', async () => { assertNoRealAi(ctx); }, {critical: true});
}


/** Record post-close answer misses as failed steps before final artifacts; declared refusals never enter this list. */
export function recordAnswerRefusals(ctx, refused) {
  if (!refused.length) return false;
  const note = `E2E_AI_ANSWER_MISSING: ${refused.map(item => item.message).join('; ')}`;
  ctx.runner.results.push({name: 'every backbone AI question had a stored answer', status: 'failed', note});
  ctx.stopped = note;
  return true;
}

// Why (31 Oct 2026, owner; Gitar on #2664): new backbone suites inherit zero misses; only an explicit lane or a named exception exempts them, read from the one lane list and the registry's one exception rule.
const missesExempt = lane => NON_BACKBONE.includes(lane?.lane) || namesException(lane);

/** Pure verdict: backbone defaults to zero; diagnostics contain only the request key, never prompt text. */
export function aiMissesVerdict(misses, lane, firstKey = '', firstAsk = '') {
  const max = missesExempt(lane) ? null : (lane?.aiMissesMax ?? 0);
  const ok = max === null || misses <= max;
  return {ok, misses, max, message: ok ? '' : `AI asks with no stored answer: ${misses} (allowed ${max}); first ask key: ${firstKey}${firstAsk ? `; ${firstAsk}` : ''}`};
}

/** Count miss JSON filenames without reading bodies; missing folders mean zero, and exempt suites do no I/O. */
export function checkAiMisses(artifacts, lane) {
  if (missesExempt(lane)) return aiMissesVerdict(0, lane);
  const dir = path.join(artifacts, 'ai-misses');
  let files;
  try { files = fs.readdirSync(dir, {withFileTypes: true}).filter(file => file.isFile() && file.name.endsWith('.json')).map(file => file.name).sort(); }
  catch (error) { if (error.code === 'ENOENT') return aiMissesVerdict(0, lane); throw error; }
  // Why (2 Nov 2026, owner: "why beta is red?"; beta 16 wizard): the key alone is a hash nobody can read; the first ask's operation and part digests (never its text) say which ask it was.
  return aiMissesVerdict(files.length, lane, files[0]?.slice(0, -5) || '', files[0] ? missLine(path.join(dir, files[0])) : '');
}
