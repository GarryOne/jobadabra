// The kind of question the AI read, in any language (src/ai/kit.py / worker/src/extension.js answer `category`: knockout, legal, demographic),
// used by the form filler before it fills anything (page/fill.js __jobPilottoExtensionFill): a legal one (a consent, terms, a certification) is
// never filled by us, whatever the English words of LEGAL say (8 Oct 2026: a Portuguese "Li e aceito a política de privacidade" was not
// caught and would have been ticked); each kind is marked on its field, so the review panel (review.js) ranks knockouts first and marks
// what to agree to yourself. Guarded by desktop/test/fill-categories.test.js.
(() => {
  window.__jobPilottoMarkCategories = (answers, rowOf) => {
    for (const item of answers || []) {
      const row = rowOf[item.field];
      if (!row || !['knockout', 'legal', 'demographic', 'preference', 'written', 'unanswered'].includes(item.category)) continue;
      if (item.category === 'preference' && item.use !== 'kind') continue;   // a proposed or typed preference is an ordinary answer; only the empty kind row is the person's own choice
      if (item.category === 'legal') row.legal = true;
      if (item.category === 'written') row.written = true;   // an open question in the person's own words that nothing given answers: left to them, never "no answer"
      if (item.category === 'unanswered') row.unanswered = true;   // asked twice, the AI named it in neither answer: said so, not left blank
      if (item.category === 'demographic') row.demographic = true;
      if (item.category === 'preference') row.demographic = true;   // the same hold: a preference nothing given states is the person's own choice   // fill.js declines it, as for the English words of DEMOGRAPHIC
      const el = document.getElementById(item.field) || document.querySelector(`[name="${CSS.escape(String(item.field).replace(/^(radio|group):/, ''))}"]`);
      if (el) el.dataset.jobpilottoCategory = item.category;
      if (el && Array.isArray(item.remind) && item.remind.length) el.dataset.jobpilottoRemind = JSON.stringify(item.remind.slice(0, 6).map(text => String(text).slice(0, 200)));   // what to add in the person's own words: shown beside the box (panel-written.js), never typed
    }
  };
})();
