// Rung 3 of the fill ladder, the worker's side (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR C2): runs the repairs the app named (desktop/lib/ladder/fill-repair.js:
// [{n, verb, option, refused}]) with the extension's existing primitives. The page's verbs (choose_option, retype, commit) run in page/repair-act.js; a real click (trusted_click,
// toggle) goes through Chrome's debugger at the spot the page gives; dismiss_layer is the layer closer (consent.js closeLayer), pressed only when the app's own pick for that layer
// is the button the repair named (one dismiss per page); wait waits. open_section and upload are not done by repair yet (said, never guessed); ask_person and a refused repair do
// nothing. At most 3 repairs (the question's cap). Counts and verbs leave this file, never a label or a value. Guard: app-core/test/fill-climb.test.js.
const WAIT_MS = 1500, SETTLE_MS = 400, CAP = 3;
const PAGE_VERBS = ['choose_option', 'retype', 'commit'], CLICK_VERBS = ['trusted_click', 'toggle'];

// tools: {page(func, args), click(x, y) (a trusted click), closeLayer({want}) -> the label pressed or '', sleep(ms)}; onTop: the sketch's layer ({buttons}) or null.
// -> [{n, verb, ok, why}] (ok undefined: not attempted)
export async function runRepairs(repairs, {page, click, closeLayer, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}, onTop = null) {
  const results = [];
  let dismissed = false;
  for (const repair of (Array.isArray(repairs) ? repairs : []).slice(0, CAP)) {
    const {n, verb, option} = repair || {};
    const done = (ok, why = '') => results.push({n, verb, ok, why});
    if (repair?.refused || verb === 'ask_person') { done(undefined, repair?.refused || 'left to the person'); continue; }
    if (verb === 'wait') { await sleep(WAIT_MS); done(true); continue; }
    if (verb === 'dismiss_layer') {
      if (dismissed) { done(undefined, 'the layer was already dismissed'); continue; }
      dismissed = true;
      const want = onTop?.buttons?.[Number(option) - 1] || '';
      const pressed = want ? await closeLayer({want}).catch(() => '') : '';
      done(!!pressed, pressed ? '' : 'the layer closer picked another button, or none: nothing pressed');
      continue;
    }
    if (PAGE_VERBS.includes(verb)) {
      const found = await page((number, name, chosen) => window.__jobadabraRepairAct?.[name]?.(number, chosen) || {ok: false, why: 'no repair here'}, [n, verb, option || 0]).catch(() => null);
      done(!!found?.ok, found?.why || (found ? '' : 'the page did not answer'));
      continue;
    }
    if (CLICK_VERBS.includes(verb)) {
      const before = await page((number, name) => window.__jobadabraRepairAct?.mayClick(number, name) ?? null, [n, verb]).catch(() => null);
      const spot = before === null ? null : await page(number => window.__jobadabraRepairAct?.spot(number) || null, [n]).catch(() => null);
      if (!spot) { done(false, 'refused, or no place to click'); continue; }
      await click(spot.x, spot.y);
      await sleep(SETTLE_MS);
      done(!!(await page((number, name, state) => window.__jobadabraRepairAct?.clicked(number, name, state) || false, [n, verb, before]).catch(() => false)));
      continue;
    }
    done(undefined, 'not done by repair yet');
  }
  return results;
}
