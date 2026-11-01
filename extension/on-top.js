// What sits ON TOP of the application form, found by structure only (owner via cc, 11 Oct 2026: a site dialog covered the form after the fill and nothing said so): the element drawn at the centre
// of each visible control and of the page is asked for; when it is neither the control nor inside it and it lives in a dialog (<dialog open>, role dialog/alertdialog, aria-modal) or in a fixed layer that
// covers most of the viewport, that layer is returned with its short text, its own buttons and the labels of the controls it covers ({covered, shape, role, text, buttons}). A closed or hidden dialog is not drawn, a header that covers a strip is not big: neither counts.
// With {press: label} it clicks that button of the layer (the closer: consent.js closeLayer) and returns {pressed}. The AI decides what it means (lib/form-judge.js blocked). Injected into the page: self-contained. Guard: desktop/e2e/test/on-top.test.mjs.
export function onTop(want = null) {
  const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const DIALOG = '[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]';
  const layerOf = top => {
    for (let node = top; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (node.matches(DIALOG)) return {node, shape: 'dialog'};
      if (getComputedStyle(node).position === 'fixed') { const box = node.getBoundingClientRect(); if (box.width * box.height >= 0.4 * innerWidth * innerHeight) return {node, shape: 'overlay'}; }
    }
    return null;
  };
  const nameOf = el => el.labels?.[0]?.innerText || el.getAttribute('aria-label') || (window.__jobPilottoFillKit?.labelOf ? window.__jobPilottoFillKit.labelOf(el) : '') || el.name;   // as the panel names a field (page/fill-labels.js), when the page has that reader
  const own = node => node.closest('[id^=jobpilotto], [id^=jobadabra]');
  const points = [...document.querySelectorAll('input, select, textarea')].filter(el => el.getClientRects().length && !['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type)).slice(0, 12)
    .map(el => ({el, box: el.getBoundingClientRect()})).filter(({box}) => box.width && box.height).map(({el, box}) => ({el, x: box.left + box.width / 2, y: box.top + box.height / 2}));
  points.push({el: null, x: innerWidth / 2, y: innerHeight / 2});
  for (const {el, x, y} of points) {
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;   // off screen: nothing is drawn there to ask
    const top = document.elementFromPoint(x, y);
    if (!top || own(top) || (el && (el.contains(top) || top.contains(el) || [...(el.labels || [])].some(label => label.contains(top))))) continue;
    const layer = layerOf(top);
    if (!layer || points.some(point => point.el && layer.node.contains(point.el))) continue;   // the form's own controls live in that layer: it is the form, nothing covers it
    const controls = [...layer.node.querySelectorAll('button, [role=button], input[type=submit], input[type=button], a')].filter(item => item.getClientRects().length);
    const labelOf = item => clean(item.innerText || item.value || item.getAttribute('aria-label') || item.getAttribute('title'), 40);
    const leavesPage = node => { const link = node.closest && node.closest('a[href]'); if (!link) return false; if (/^(_blank|_top|_parent)$/i.test(link.getAttribute('target') || '')) return true; try { const to = new URL(link.href, location.href); return to.protocol !== 'javascript:' && to.href.split('#')[0] !== location.href.split('#')[0]; } catch { return true; } };   // the shared floor (app-core/test/popup-press-stays.test.js)
    if (want?.press) { const found = controls.find(item => labelOf(item) === want.press && !leavesPage(item)); if (found) (globalThis.__jobPilottoPress?.(found) || found.click()); return {pressed: found && !window.__jobPilottoRefused ? labelOf(found) : ''}; }   // a press the floor refused (page/submit-press.js) is no press   // the app's pick, pressed only if it is a button OF this layer
    const buttons = [...new Set(controls.map(labelOf).filter(Boolean))].slice(0, 6);
    const covered = points.filter(point => point.el && (hit => hit && layer.node.contains(hit))(document.elementFromPoint(point.x, point.y))).map(point => clean(nameOf(point.el), 60)).filter(Boolean);   // the form's own controls this layer is drawn over
    return {covered, shape: layer.shape, role: clean(layer.node.getAttribute('role') || layer.node.tagName.toLowerCase(), 20), text: clean(layer.node.innerText || layer.node.textContent, 160), buttons};
  }
  return null;
}
