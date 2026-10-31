/* global window */
// Independent steps: one failing step is recorded and the next still runs, so a failure never hides the others. The suite fails at the end when any did.
export function independent(ctx) {
  let failed = 0;
  // safety: a step that proves a safety rule (lib/safety-steps.mjs) is never suspended.
  // needs: what this one step needs beyond the suite's (a missing one skips the step by name, lib/runner.mjs), e.g. a feature still being built on one store.
  const step = async (name, fn, {needs = [], safety = false} = {}) => { try { await ctx.run(name, fn, {needs: [...(ctx.needs || []), ...needs], safety}); } catch { failed++; } };
  const end = () => { if (failed) throw new Error(`${failed} step(s) failed`); };
  return {step, end};
}

// Stands in for what the app hands to the operating system: a link opened in the browser or in Notion is recorded, never opened (no network, no windows).
export async function captureExternal(app) {
  await app.evaluate(({shell}) => {
    globalThis.__e2eExternal = [];
    shell.openExternal = async url => { globalThis.__e2eExternal.push(String(url)); };
  });
  return {
    urls: () => app.evaluate(() => globalThis.__e2eExternal.slice()),
    clear: () => app.evaluate(() => { globalThis.__e2eExternal.length = 0; }),
  };
}

// The app asks "Delete …?" with the page's confirm(): answer it for the person, without a native dialog that would block every later command.
export const answerConfirms = (page, answer = true) => page.evaluate(value => { window.confirm = () => value; }, answer);

export const ids = value => String(value || '').replace(/-/g, '');
