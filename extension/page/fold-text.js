// The one way the page scripts compare an answer with an option or a label: accents, case and spacing ignored ("Zurich" is "Zürich"). Loaded first (page-files.js).
// Guarded by app-core/test/fold-text.test.js, which loops over every matcher that uses it.
(() => {
  if (window.__jobPilottoFold) return;
  window.__jobPilottoFold = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
})();
