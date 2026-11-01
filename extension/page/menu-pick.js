// Picking a menu's option and checking it took (owner, 9 Oct 2026, Migros on SuccessFactors: a scripted click on the option was ignored by the widget, and
// "a menu picked for you, matched" was logged over an empty field). Runs in the page (main world) before fill.js, which calls __jobadabraMenuPick from its
// armed-menu handler. A pick counts only when the page shows it: our reader sees a value, the option says selected, or the box shows the option AND the menu
// closed (text typed to filter a long menu, the menu still open, is not a choice). When the widget ignores the scripted click, the option's spot is left in
// __jobadabraPickSpot for flow.js clickCombos, which clicks it for real through Chrome's debugger; the selection is then waited for and checked again.
// → {selectedAfter, trusted}. Guarded by desktop/e2e/test/menu-pick.test.mjs (three shapes: real click only, plain, never selects).
(() => {
  if (window.__jobadabraMenuPickLoaded) return;
  window.__jobadabraMenuPickLoaded = true;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // A menu that takes several choices (`multiple`): an earlier pick's chip is already there, so "some chip exists" proves nothing about THIS option: its own chip must (15 Oct 2026: the
  // second and third language of a multi-select were reported picked without ever being clicked).
  const holdsOwn = (el, option) => { const root = el.closest('[class*=value-container], [class*=select__container]') || el.parentElement; return [...(root?.querySelectorAll('[class*=multi-value]') || [])].some(chip => norm(chip.textContent).includes(norm(option.textContent))); };
  window.__jobadabraMenuPick = async ({el, option, control, readValue, multiple = false}) => {
    const selected = () => (multiple ? holdsOwn(el, option) : !!readValue?.(el)) || (option.isConnected && option.getAttribute('aria-selected') === 'true') ||
      (norm(el.value) === norm(option.textContent) && el.getAttribute('aria-expanded') !== 'true');
    (globalThis.__jobadabraPress?.(option) || option.click());
    await sleep(200);
    if (selected()) return {selectedAfter: true, trusted: false};
    option.scrollIntoView({block: 'nearest'});
    const spot = option.getBoundingClientRect();
    window.__jobadabraPickSpot = {x: Math.round(spot.left + Math.min(30, spot.width / 2)), y: Math.round(spot.top + spot.height / 2), label: control?.dataset.jobadabraArmed || ''};
    for (let waited = 0; waited < 4000; waited += 150) {
      await sleep(150);
      if (selected()) { window.__jobadabraPickSpot = null; return {selectedAfter: true, trusted: true}; }
    }
    window.__jobadabraPickSpot = null;
    return {selectedAfter: false, trusted: true};
  };
})();
