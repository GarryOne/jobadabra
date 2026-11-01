// A box that only takes a suggestion the page offers (owner, 15 Oct 2026: a job board's own location widget searched only on a key press, kept a place only when one of its suggestions was pressed
// and emptied the box when focus left, so the plain text the fill typed vanished and the box read as empty). Three structural helpers, no site and no word list: which just-typed boxes are empty again
// once focus has left (lostOnBlur), the options that appeared next to a box once it was typed in for real (snapshot/appeared: new visible text nodes beside it, whatever their markup), and whether the box
// holds a chosen option (holds). fill.js arms the lost boxes as type-to-search boxes (page/fill-menus.js pickSuggestion). Guarded by desktop/e2e/recorded/suggest-only-place-*.
(() => {
  if (window.__jobPilottoSuggest) return;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const fold = window.__jobPilottoFold;   // page/fold-text.js, loaded first: accents, case and spacing ignored
  const OWN = '[class*="jobadabra"], [id*="jobadabra"], [id*="jobpilotto"], [data-jobpilotto-armed]';
  // Every visible text node's element with no element inside (a suggestion row, a notice), the extension's own boxes left out.
  const leaves = () => Array.from(document.body.querySelectorAll('*')).filter(node => !node.children.length && fold(node.textContent) && node.offsetParent !== null && !node.closest(OWN));
  const snapshot = () => new Set(leaves());
  // What is new since `before`, beside the box: from just above its top to 600 px under it, overlapping it sideways.
  const appeared = (el, before) => {
    const box = el.getBoundingClientRect();
    return leaves().filter(node => {
      if (before.has(node) || node === el || node.contains(el)) return false;
      const rect = node.getBoundingClientRect();
      return rect.top >= box.top - 4 && rect.top <= box.bottom + 600 && rect.right > box.left && rect.left < box.right;
    });
  };
  // The text boxes the fill typed that are empty again a moment later: the fill leaves each box the way a person does (focus, then blur: browser-form-fastpath.js) and a page that does not keep text it was
  // not offered empties it then. entries: the fill's answers [{field, value}]; typedKeys: the fields the fill typed.
  const textBox = el => el && el.tagName === 'INPUT' && ['text', 'search', ''].includes(String(el.getAttribute('type') || '').toLowerCase()) && !el.readOnly && !el.disabled && el.getAttribute('role') !== 'combobox';
  const lostOnBlur = async (entries, typedKeys = []) => {
    const keys = new Set(typedKeys.map(String));
    const typed = entries.filter(entry => keys.has(String(entry.field)) && String(entry.value || '').trim())
      .map(entry => ({...entry, el: document.getElementById(entry.field) || document.querySelector(`[name="${CSS.escape(entry.field)}"]`)})).filter(entry => textBox(entry.el));
    if (!typed.length) return [];
    await sleep(250);   // a page's blur handler may run a tick later
    return typed.filter(({el}) => !String(el.value || '').trim());
  };
  // The box holds the option the page was asked for: its text is the option's and the option's list is gone.
  const holds = (el, option) => fold(el.value) === fold(option.textContent) && (!option.isConnected || option.offsetParent === null);
  window.__jobPilottoSuggest = {snapshot, appeared, lostOnBlur, holds, textBox};
})();
