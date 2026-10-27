// The form filler's highlight (split from page/fill.js, 9 Oct 2026): a soft amber glow on answers the AI wrote, removed when you edit them.
// Needs page/fill-labels.js first.
(() => {
  if (window.__jobPilottoFillMarksLoaded) return;
  window.__jobPilottoFillMarksLoaded = true;
  const {clean, isCombo, comboControl} = window.__jobPilottoFillKit;

  // The page's highlight for fields (one stylesheet, added once, shared by fill.js and review.js): a soft amber ring
  // and glow instead of a hard border or outline. "review": an answer the AI wrote (pulses 3 times, then stays soft);
  // "flash": the field the panel or the app pointed at (pulses, removed after a few seconds).
  const glowStyle = () => {
    if (document.getElementById('jobpilotto-glow-style')) return;
    const style = document.createElement('style');
    style.id = 'jobpilotto-glow-style';
    style.textContent = `
      @keyframes jobpilotto-pulse { 0%, 100% { box-shadow: 0 0 0 2px rgba(245,158,11,.45), 0 0 10px 2px rgba(245,158,11,.18); }
        50% { box-shadow: 0 0 0 3px rgba(245,158,11,.75), 0 0 22px 6px rgba(245,158,11,.35); } }
      .jobpilotto-review { box-shadow: 0 0 0 2px rgba(245,158,11,.45), 0 0 10px 2px rgba(245,158,11,.18) !important;
        animation: jobpilotto-pulse 1.4s ease-in-out 3; transition: box-shadow .3s ease; }
      .jobpilotto-flash { box-shadow: 0 0 0 3px rgba(255,178,36,.8), 0 0 24px 6px rgba(255,178,36,.35) !important;
        animation: jobpilotto-pulse 1s ease-in-out 3; transition: box-shadow .3s ease; }
      @media (prefers-reduced-motion: reduce) { .jobpilotto-review, .jobpilotto-flash { animation: none; } }`;
    document.head.append(style);
  };

  // ---- Live panel: re-checks the page as the user works, so done items disappear and it turns green. ----
  const attention = new Map();  // field id -> label: AI-written answers the user should read
  // Orange border + tag on answers the AI wrote (long text, cover letter, low confidence); cleared when the user edits.
  const markAttention = (field, label) => {
    const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
    if (!el || attention.has(field)) return;
    const target = isCombo(el) ? comboControl(el) : el;
    // A soft amber glow on the field's own box (no caption): the box is the first of the field and its wrappers that
    // has a border, else the field itself.
    let frame = target;
    for (let box = target, i = 0; box && i < 4; box = box.parentElement, i++)
      if (parseFloat(getComputedStyle(box).borderBottomWidth) > 0) { frame = box; break; }
    const before = {title: el.title};
    glowStyle();
    frame.classList.add('jobpilotto-review');
    el.title = 'Written by AI: read it before submitting';
    el.setAttribute('data-jobpilotto-ai', '');
    attention.set(field, clean(label).slice(0, 500));
    const clear = event => {
      if (!event.isTrusted) return;
      frame.classList.remove('jobpilotto-review');
      el.title = before.title; el.removeAttribute('data-jobpilotto-ai'); attention.delete(field);
      el.removeEventListener('input', clear);
    };
    el.addEventListener('input', clear);
  };
  // A written answer WE drafted from the person's facts (owner, 16 Oct 2026): marked until the person edits it or presses "Keep as is" in the panel; the panel lists it as "Drafted for you: review",
  // never as filled. An outline (kind "outline": "• Add: ..." lines) stays marked while any such line is left, so an unfinished outline never counts as an answer. Guarded by desktop/test/written-draft.test.js.
  const ADD_LINE = /^\s*•\s*Add:/m;
  const markDraft = (field, kind) => {
    const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
    if (!el || !String(el.value || '').trim()) return;
    el.dataset.jobpilottoDraft = kind === 'outline' ? 'outline' : 'draft';
    const check = event => {
      if (!event.isTrusted) return;
      if (el.dataset.jobpilottoDraft === 'outline' && ADD_LINE.test(el.value)) return;
      delete el.dataset.jobpilottoDraft; el.removeEventListener('input', check);
    };
    el.addEventListener('input', check);
  };
  // A "• Add: ..." reminder is never typed (owner, 27 Oct 2026): every answer's value is split before the fill types it, its reminders kept on the answer (remind) for the panel.
  // The answers call already splits them (worker/src/written-answer.js splitReminders, the same rule); this is the floor for a cached answer or an older service.
  const splitReminders = value => {
    const remind = [];
    const text = String(value ?? '').split('\n').map(line => {
      const [before, ...rest] = line.split(/\s*•\s*Add:\s*/);
      for (const item of rest) if (item.trim()) remind.push(item.trim());
      return rest.length ? before.trimEnd() : line;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return {text, remind};
  };
  Object.assign(window.__jobPilottoFillKit, {markAttention, markDraft, splitReminders});
})();
