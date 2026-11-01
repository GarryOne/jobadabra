// Each apply step ends with no more browser tabs than it began with: a form tab opened by a step is closed by that step, never left for a sweep at the end of the suite.
// Job: wait on state
// Why (31 Oct 2026, a8; coordinator, beta 41242762348 apply-2of3): form tabs of finished steps stayed open in the real Chrome, 7 sessions' forms by 21:40:48, and chrome.storage reads went 7 s -> 37 s as they piled up
// on the slow Mac runner; the part ran 716 s of 660 (cause not proven, but a pile of tabs is never what a step is meant to leave).
// Invariants: the baseline is the set of live tabs when the step starts; a step that launched the browser has none (nothing to compare); a failed step still closes its tabs and its own error stays the error; a step that ends after a later one began does nothing (the runner left it);
// `keepsTabs: '<key>'` hands this step's tabs to a later step on purpose and `closesTabs: '<key>'` makes that later step close the tabs kept under the same key (a pair, never all of them); with `close: false` the guard only reports (a red naming the step).
// Tests: test/harness/tab-guard.test.mjs
const live = page => page && !page.isClosed?.();
const urlOf = page => { try { return String(page.url()).split(/[?#]/)[0].slice(0, 80); } catch { return '(closed)'; } };

/**
 * @param {{browser?: {context: {pages: () => object[]}}}} ctx  the suite's context; its browser exists once a step launched it
 * @param {(name: string, fn: () => Promise<unknown>, options?: object) => Promise<unknown>} run  the runner's run (ctx.run)
 * @param {{close?: boolean}} [options]  close: false only reports (a step that leaves a tab fails, naming it)
 * @returns {(name: string, fn: () => Promise<unknown>, options?: object) => Promise<unknown>}  a run that holds every step to its baseline
 */
export function tabGuard(ctx, run, {close = true} = {}) {
  const carried = new Map();   // key -> tabs a step kept on purpose (keepsTabs), until the step with the same closesTabs key ends
  let current = 0;   // the newest step that began: a hung step the runner left (lib/runner.mjs withLimit) must not clean up inside the next one
  const tabs = () => (ctx.browser?.context ? ctx.browser.context.pages().filter(live) : null);
  return (name, fn, options = {}) => {
    let begun = null, mine = 0;
    const guarded = async () => {
      mine = ++current;
      begun = tabs();
      let result;
      try { result = await fn(); } catch (error) { await settle(false); throw error; }
      await settle(true);
      return result;
    };
    async function settle(report) {
      if (mine !== current) return;   // Why (31 Oct 2026, a8; Gitar on #2745): a step that hung past its cap ends later, while the next step runs; its snapshot would count that step's fresh tabs as its own and close them
      const now = tabs();
      if (!begun || !now) return;
      const own = now.filter(page => !begun.includes(page));
      const handed = options.closesTabs ? [...(carried.get(options.closesTabs) || [])].filter(live) : [];
      const extras = [...own, ...handed];
      if (options.keepsTabs && report) { carried.set(options.keepsTabs, [...(carried.get(options.keepsTabs) || []), ...own]); return; }
      if (options.closesTabs) carried.delete(options.closesTabs);
      if (!extras.length) return;
      const urls = extras.map(urlOf);
      if (close) await Promise.all(extras.map(page => page.close().catch(() => {})));
      const left = close ? extras.filter(live) : extras;
      if (report && left.length) throw new Error(`the step "${name.slice(0, 90)}" left ${left.length} browser tab(s) open (${(close ? left.map(urlOf) : urls).join(', ')}): a step closes the tabs it opened, at its own end`);
    }
    return run(name, guarded, options);
  };
}
