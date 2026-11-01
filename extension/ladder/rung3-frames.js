// Frames that may hold the application form (page/frames.js): the iframes of a page judged "no form" that are big enough to be one, by STRUCTURE only
// (https, another host, visible, >= 300x200). Which of them IS the form is the page-kind AI's answer (an index into this list, `form_frame`; no
// word, vendor or cookie list here). The full address (src) stays inside the extension: only host, path and size go to the AI, never a query string
// (a form frame's address holds a token). Owner of the choice and the navigation: extension/fill-flow.js. Guard: app-core/test/page-frames.test.js.
(() => {
  // -> [{host, path, src, width, height}], biggest first. `src` is for the extension's own use (opening that frame), never sent anywhere.
  function frameCandidates(doc = document, here = location) {
    const out = [];
    for (const frame of doc.querySelectorAll('iframe[src]')) {
      let url;
      try { url = new URL(frame.getAttribute('src'), here.href); } catch { continue; }
      const box = frame.getBoundingClientRect();
      if (url.protocol !== 'https:' || url.host === here.host || !frame.getClientRects().length || box.width < 300 || box.height < 200) continue;
      out.push({host: url.hostname, path: url.pathname, src: url.href, width: Math.round(box.width), height: Math.round(box.height)});
    }
    return out.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 6);
  }
  const api = {frameCandidates};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobadabraFrames = api;
})();
