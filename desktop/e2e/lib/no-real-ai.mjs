// Counts the AI calls of a test run that went on to a real model; a suite whose AI is all stand-in ends with a step that fails when any did (strategy, 18 Oct 2026: it reached gpt-6-luna).
// Job: serve stored answers
export const realAiCalls = ctx => (ctx.proxy?.stats.paid || 0) + (ctx.openaiProxy?.stats.paid || 0);

// Throws, naming the count, when a call was paid for.
export function assertNoRealAi(ctx) {
  const paid = realAiCalls(ctx);
  if (paid) throw new Error(`${paid} AI call(s) reached a real model although this suite's stand-in should answer every one (see the "ai-proxy refusal" lines above, or the AI cost lines)`);
}

/** Fail on any request activity on either proxy, including refused and canned questions. */
export function assertNoAiQuestions(ctx) {
  // Why (29 Oct 2026, owner): settings must ask no AI question at all; refusing or replaying a question still fails this check.
  const activity = ['proxy', 'openaiProxy'].flatMap(name => Object.entries(ctx[name]?.stats || {})
    .filter(([counter, value]) => counter !== 'delayMs' && typeof value === 'number' && value !== 0)
    .map(([counter, value]) => `${name}.${counter}=${value}`));
  if (activity.length) throw new Error(`AI question reached an offline suite's proxy: ${activity.join(', ')}`);
}

/** Run the suite's declared AI checks through the captured, unfiltered critical-step runner. */
export async function runAiGuards(suite, ctx, runAlways) {
  // A suite that declares `export const realAi = false` answers every AI call with a stand-in: one that reached a real model fails the run (test/suite-ai-mode.test.mjs).
  if (suite.realAi === false) await runAlways('no AI call of this suite reached a real model: the stand-in answered or refused every one', async () => { assertNoRealAi(ctx); }, {critical: true});
  if (suite.offlineAi) await runAlways('no AI question reached the proxy at all', async () => { assertNoAiQuestions(ctx); }, {critical: true});
}
