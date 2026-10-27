// One armed dropdown, clicked for real and waited for until the page has finished deciding (split from flow.js clickCombos, 11 Oct 2026).
// The page opens the menu, filters it and picks the answer after the click, which can take seconds (the menu's own wait, then the typing wait of a
// search field). A second click before it finished toggled the menu shut and the result was read before the page wrote it (Ocado, right to work:
// "no option matched" on one run, "menu did not open" on the next). Guarded by desktop/e2e/test/combo-click.test.mjs.
// ceiling: the most one menu may take in all (14 Oct 2026, 5afa5a8's look-alike: a suggest-only address box whose list never opens kept asking for typing / kept "picking", each ask pushed the
// limit out another 9 s, and the wait never ended: 30-40 s of silence, then "dead end: silent" with the late answers behind it).
// busy time (14 Oct 2026, a loaded machine: the page's main thread was blocked 10-15 s after the click, so the extension's own calls hung and the wall clock ran out on a menu
// that was only slow, "given up" and left): a call that took longer than slowCall (or a 100 ms sleep that woke later than that) is the page being busy, not the menu being dead; that time does not count against the waits or
// the ceiling. `hard` bounds the whole menu in real time anyway (a page that never answers is still given up on; flow.js STEP_MS.combo is above it).
// Known leftover (14 Oct 2026, coreweave replay on a Mac at load 100+): the AI pick (choose) took 16-30 s on a starved worker (its own 20 s timer fired at 30 s) and ate the menu's 35 s, so the menu read "No options" and was given up. A retry of the menu was tried (#735) and dropped: it doubles a never-opens menu's wait and trips "dead end: silent".
const PATIENCE = {first: 1500, loading: 5000, option: 4500, deciding: 9000, ceiling: 15000, hard: 30000, slowCall: 150};

// type(text): real typing over the box's content. choose({asked, choices, label}): the AI's pick of one choice by meaning, or ''.
// page(func, args): runs func in the page (MAIN world). click(x, y): a trusted click. spot: the armed menu's spot from __jobPilottoNextCombo.
// Returns {picked, last}: whether the armed count dropped, and what the page observed (__jobPilottoLastPick, read once the page is done).
export async function clickCombo({page, click, spot, skip = 0, type = null, choose = null, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, marks = []}) {
  let picked = false, last = null, capped = false;
  const began = now();
  let busy = 0;   // ms spent inside calls that answered slowly (the page's main thread was blocked); only the excess over slowCall counts, so there is no cliff at the threshold. Calls are awaited one at a time here: run in parallel they would count twice, `hard` still bounds that
  const timed = fn => async (...args) => { const t = now(); try { return await fn(...args); } finally { const d = now() - t; if (d > PATIENCE.slowCall) busy += d - PATIENCE.slowCall; } };
  page = timed(page); click = timed(click); if (choose) choose = timed(choose);   // the AI's pick is the AI's time, not the menu's: a search box asks it more than once (page/fill-menus.js searchFor)
  const sleepFor = sleep;
  sleep = async ms => { const t = now(); await sleepFor(ms); const late = now() - t - ms; if (late > PATIENCE.slowCall) busy += late - PATIENCE.slowCall; };   // a starved worker wakes late too
  const over = () => now() - began >= PATIENCE.hard || now() - began - busy >= PATIENCE.ceiling;
  const mark = tag => { marks.push(`${tag}@${now() - began}`); if (marks.length > 40) marks.shift(); };   // where the time went, said when a menu is given up (flow.js)   // every wait below is REAL time: counting 100 ms ticks let a busy page (each call taking a second or more) stretch a 1.5 s wait to 30 s
  for (let attempt = 1; attempt <= 2 && !picked; attempt++) {
    const before = await page(() => window.__jobPilottoArmedCount());
    const at = attempt === 1 ? spot : await page(n => window.__jobPilottoNextCombo(n), [skip]);
    if (!at) break;
    mark(`click${attempt}`);
    await click(at.x, at.y);
    mark(`clicked${attempt}`);
    const loading = () => page(() => !!document.querySelector('[class*=loading-indicator], [class*=loadingIndicator], [class*=menu-notice--loading], [class*=loadingMessage]'));
    let spotClicked = false;
    const lookStart = now(), lookBusy = busy;
    const waitedNow = () => now() - lookStart - (busy - lookBusy);
    for (let waited = 0, limit = PATIENCE.first; waited < limit; waited = waitedNow()) {
      if (over()) { capped = true; break; }
      mark('turn');
      await sleep(100);
      waited = waitedNow();
      if ((await page(() => window.__jobPilottoArmedCount())) < before) break;
      if (over()) { capped = true; break; }   // after every slow call, not once a turn: a busy page makes a turn many seconds long
      // The menu ignored a scripted click on its option: the page left the option's spot, clicked here for real once (page/fill-menus.js armCombo).
      const spotAt = spotClicked ? null : await page(() => window.__jobPilottoPickSpot || null);
      if (spotAt) { spotClicked = true; await click(spotAt.x, spotAt.y); limit = Math.max(limit, waited + PATIENCE.option); }
      // The page needs what only the extension can do (page/fill-menus.js typeToSearch): type for real, or have the AI pick from the options shown.
      const needed = await page(() => { const need = window.__jobPilottoNeed; window.__jobPilottoNeed = null; return need || null; });
      if (needed) {
        mark(`need-${needed.kind}`);
        const value = needed.kind === 'type' ? await type?.(needed.text, needed.keys).then(() => true, () => false) : await choose?.(needed).catch(() => '');
        await page(done => { window.__jobPilottoNeedDone = done; }, [value ?? false]);
        limit = Math.max(limit, waited + PATIENCE.deciding);
      }
      if (over()) { capped = true; break; }
      if (limit < PATIENCE.loading && await loading()) limit = PATIENCE.loading;
      // The page is still deciding (page/fill-menus.js __jobPilottoPicking): its answer comes before any second click.
      if (limit < PATIENCE.deciding && await page(() => !!window.__jobPilottoPicking)) limit = PATIENCE.deciding;
    }
    picked = (await page(() => window.__jobPilottoArmedCount())) < before && !(await page(() => !!window.__jobPilottoLastPick?.refused));   // a menu its attempt log refused was disarmed, not picked
    if (picked) break;
    // What the page saw this time. A menu that opened and showed no choice for the answer is not helped by a second click: it shuts the open menu and
    // the second pick overwrites the true observation with "did not open" (the Ocado runs). Retry only when the page never opened it.
    last = await page(() => window.__jobPilottoLastPick || null);
    await click(5, 5).catch(() => {}); await sleep(100);  // close the menu
    if (last?.opened || capped) break;
  }
  last = await page(() => { const pick = window.__jobPilottoLastPick || null; window.__jobPilottoLastPick = null; return pick; }) || last;
  return {picked, last, capped};
}
