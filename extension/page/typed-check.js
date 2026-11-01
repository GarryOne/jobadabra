// The panel's end-of-fill check that every value we typed is still in its box (12 Oct 2026, Recruitee: a phone widget went back to its own "+972" and the panel said
// "Ready to submit, every required field is filled"). The fill leaves what it typed on the box (data-jobadabra-typed: its letters and digits, set by
// page/browser-form-fastpath.js); a box that holds something else now is not filled, whatever its count says. A box the person edited loses that mark.
// Also the one rule for "does this box hold anything" where the readers ask (window.__jobadabraBoxGiven; loaded in both worlds).
// A changed box also asks the page script to type it again (event jobadabra-retype, at most every 3 s, 6 times a page). Content-script world (the panel's list in
// background.js). Same rule as the fill's typedSame in the page script: desktop/test/typed-match.test.js keeps the two equal.
(() => {
  const alnum = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const same = (typed, now) => {
    const a = String(typed), b = alnum(now);
    if (!a || a === b || b.includes(a) || (b.length >= 6 && a.includes(b))) return true;
    if (a.length >= 8 && b.length >= 8 && /^\d+$/.test(a) && /^\d+$/.test(b) && a.slice(-8) === b.slice(-8)) return true;
    return [...a].sort().join('') === [...b].sort().join('');
  };
  // A box holding only a calling code is empty: an international phone widget starts on its own country's code ("+972"), and a reader that called that filled never typed our number (12 Oct 2026, Recruitee).
  window.__jobadabraBoxGiven = value => { const text = String(value ?? '').trim(); return !!text && !/^\+\d{1,4}$/.test(text); };
  let asked = 0, lastAsk = 0;
  window.__jobadabraTypedSame = same;
  window.__jobadabraTypedChanged = el => {
    const typed = el.getAttribute?.('data-jobadabra-typed');
    if (!typed || same(typed, el.value)) return false;
    if (asked < 6 && Date.now() - lastAsk > 3000) { asked += 1; lastAsk = Date.now(); document.dispatchEvent(new CustomEvent('jobadabra-retype')); }
    return true;
  };
})();
