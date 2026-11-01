// The end check's page-side half (lib/end-shot.mjs): a cookie layer still open at the end of a run = a visible fixed or sticky overlay (or a dialog) that speaks of cookies and holds a button. -> its button labels.
// By its own look, not by the extension's selector list: that list is broad on purpose and also matches a page-wide wrapper (Fidag's end check named the language switch and the map's controls). Guards: worker/test/cookie-layer-left.test.js, test/filling/end-cookie-layer.test.mjs.
/* global document, getComputedStyle */
export function cookieLayerLeft() {
  const ABOUT = /cookie|gdpr|traceurs|tracking/i;
  const shown = node => { const box = node.getBoundingClientRect(), look = getComputedStyle(node); return box.width > 0 && box.height > 0 && look.visibility !== 'hidden' && look.display !== 'none'; };
  const over = node => /^(fixed|sticky)$/.test(getComputedStyle(node).position) || node.matches('[role=dialog], [aria-modal=true], dialog');
  const labels = node => [...node.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')].filter(shown)
    .map(button => (button.innerText || button.value || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found = [];
  for (const node of document.querySelectorAll('body *')) {
    if (!over(node) || !shown(node) || !ABOUT.test(node.innerText || '') || (node.innerText || '').length > 1500) continue;
    found.push(...labels(node));
  }
  return [...new Set(found)].slice(0, 8);
}
