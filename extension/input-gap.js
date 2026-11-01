// The driver's gap in the fill overlay (extension/panel-overlay.js): the extension's own input through Chrome's debugger is as trusted as the person's, so around each of its actions the page
// carries data-jobadabra-driving, which lets that input through while the person's stays held. Several actions may overlap (counted per tab); the mark goes when the last one ends, also on an error.
// Every debugger input is wrapped: desktop/test/fill-overlay.test.js fails for one that is not.
const open = new Map();   // tab id -> how many actions hold the gap
const mark = (tabId, on) => chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: value => { if (value) document.documentElement.setAttribute('data-jobadabra-driving', '1'); else document.documentElement.removeAttribute('data-jobadabra-driving'); }, args: [on]}).catch(() => {});

export async function driving(tabId, work) {
  open.set(tabId, (open.get(tabId) || 0) + 1);
  if (open.get(tabId) === 1) await mark(tabId, true);
  try { return await work(); }
  finally {
    const left = (open.get(tabId) || 1) - 1;
    if (left > 0) open.set(tabId, left); else { open.delete(tabId); await mark(tabId, false); }
  }
}
