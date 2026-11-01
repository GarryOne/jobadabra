// What the flow reads off a page, as two closed scripts run in the tab (moved out of fill-flow.js, 13 Oct 2026, a pure move): pageShape (the counts of fields, files, frames and the document's status)
// and pageSketchOf (the page's sketch for the AI that decides its kind: headings, controls, buttons, frames). Both are closed scripts: desktop/e2e/ladder-capture.mjs runs pageSketchOf's body on its own.
// Guards: desktop/test/named-controls.test.js, desktop/e2e/test/own-ui-not-read.test.mjs, desktop/e2e/test/ladder-capture-frames.test.mjs.
export function pageShape(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, func: () => {
    const shown = el => el.getClientRects().length > 0 && el.type !== 'hidden';
    const controls = [...document.querySelectorAll('input, textarea, select')].filter(shown);
    const skip = new Set(['submit', 'button', 'reset', 'search', 'image', 'password', 'file', 'hidden']);
    return {
      fields: controls.filter(el => el.tagName !== 'TEXTAREA' && !skip.has(el.type)).length,
      passwords: controls.filter(el => el.type === 'password').length,
      files: controls.filter(el => el.type === 'file').length,
      anyFiles: document.querySelectorAll('input[type=file]').length,   // an upload behind a button ("Upload a CV"): its input is hidden
      textareas: controls.filter(el => el.tagName === 'TEXTAREA').length,
      nodes: document.getElementsByTagName('*').length,   // still growing: a page that renders its form after the load
      frames: [...document.querySelectorAll('iframe')].filter(el => { const box = el.getBoundingClientRect(); return box.width > 40 && box.height > 40; }).length,   // a check drawn in a frame, often seconds after the load
      // Their hosts, as the page-kind sketch gives them: a frame is often there before its address (about:blank first), so a host that shows up later counts as new.
      frameHosts: [...new Set([...document.querySelectorAll('iframe')].filter(el => { const box = el.getBoundingClientRect(); return box.width > 40 && box.height > 40; })
        .map(el => { try { return new URL(el.src, location.href).hostname; } catch { return ''; } }).filter(Boolean))],
      status: performance.getEntriesByType('navigation')[0]?.responseStatus || 0,   // the server's answer for this document (ladder/site-broken.js); 0 when unknown
    };
  }}).then(rows => rows?.[0]?.result || null).then(async shape => (shape ? {...shape, choices: await choiceGroups(tabId)} : shape)).catch(() => null);
}
// The question steps drawn with plain buttons (page/choice-step.js: structure only, while a control waits for the answer). The finder is injected when this page has not loaded it yet.
async function choiceGroups(tabId) {
  const look = () => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: () => window.__jobadabraChoiceStep?.groups().length}).then(rows => rows?.[0]?.result).catch(() => undefined);
  let found = await look();
  if (found == null) { await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: ['page/choice-step.js']}).catch(() => {}); found = await look(); }   // null: executeScript gives no result for an undefined one
  return Number(found) || 0;
}
// A sketch of the page for the AI that decides its kind (desktop/lib/page-kind.js): headings, every visible control's type and label
// (never its value), and the buttons and short links a person could press. In the page's own language: nothing here matches words.
// The label right before a box (page/label-before.js) and the required mark (page/required-mark.js) must be in this world when the sketch asks for them.
export const labelReaderIn = tabId => chrome.scripting.executeScript({target: {tabId}, files: ['page/required-mark.js', 'page/label-before.js']}).catch(() => {});
export function pageSketchOf(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, func: () => {   // a closed script: desktop/e2e/ladder-capture.mjs runs its body on its own (no arguments)
    // Never the extension's own UI (the panel's shadow root, the step box, the note, the Submit guard: ids jobadabra-*, jobadabra-*): what the AI is shown is the page,
    // not our panel's state at that moment (speed-5x, 11 Oct 2026: "Tailor my CV", "77 left required fields" in the sketch). Guard: desktop/e2e/test/own-ui-not-read.test.mjs.
    const shown = el => el.getClientRects().length > 0 && !el.closest('[id^=jobadabra], [id^=jobadabra]');
    const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
    const labelOf = el => text(el.labels?.[0]) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.type !== 'hidden' && window.__jobadabraLabelBefore?.(el)) || el.name || '';
    // Also inside open shadow roots: a page built of web components (SmartRecruiters, 9 Oct 2026) otherwise reads as empty.
    const all = selector => { const found = []; const walk = root => { found.push(...root.querySelectorAll(selector)); for (const el of root.querySelectorAll('*')) if (el.shadowRoot && !/^job-?pilotto/.test(el.id)) walk(el.shadowRoot); }; walk(document); return found; };
    const controls = all('input, select, textarea')
      .filter(el => el.type === 'file' || (el.type !== 'hidden' && shown(el)))   // an upload behind a button keeps its input hidden
      .filter(el => !['submit', 'button', 'reset', 'image'].includes(el.type))
      .map(el => ({type: el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase(), label: labelOf(el).slice(0, 80), required: window.__jobadabraRequired?.marked ? window.__jobadabraRequired.marked(el) : (!!el.required || el.getAttribute('aria-required') === 'true')}));
    // An open modal dialog (a start step over the posting: jobs.ch "Create an account to apply faster", 11 Oct 2026) sits last in the DOM, behind the page's own navigation, so the 20-button cap cut it off and
    // the AI never saw its routes. What a person can act on is the dialog: its buttons and headings come first (found by structure only: a dialog the page shows, with or without the `open` attribute (jobs.ch shows its <dialog> by CSS, no `open`; its buttons are only listed when shown, so a closed one adds nothing); the AI still decides what they mean). Order only: the list is the same.
    const modalFirst = els => { const inModal = el => !!el.closest?.('dialog, [role=dialog], [role=alertdialog], [aria-modal=true]'); return [...els.filter(inModal), ...els.filter(el => !inModal(el))]; };
    const buttons = modalFirst(all('button, input[type=submit], [role=button], a').filter(shown))
      .map(el => (el.tagName === 'INPUT' ? el.value : text(el))).filter(words => words && words.length <= 40);
    // The hosts of visible frames (a check drawn in a frame): the AI decides what they are (desktop/lib/page-kind.js bot_check).
    const frames = [...document.querySelectorAll('iframe')].filter(el => { const box = el.getBoundingClientRect(); return box.width > 40 && box.height > 40; })
      .map(el => { try { return new URL(el.src, location.href).hostname; } catch { return ''; } }).filter(Boolean);
    return {title: document.title, headings: modalFirst(all('h1, h2, h3').filter(shown)).map(text).filter(Boolean).slice(0, 8),
      controls: controls.slice(0, 50), buttons: [...new Set(buttons)].slice(0, 20), frames: [...new Set(frames)].slice(0, 5)};
  }}).then(rows => rows?.[0]?.result || null).catch(() => null);
}
