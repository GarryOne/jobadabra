// Session page, "Form completion" card and "Before you submit" box (knockout questions, which CV goes in).
// Moved out of session-needs.js, which calls showFormCard from showFormState. Guarded by test/form-tab-closed.test.js
// and test/need-proposal.test.js (npm test in desktop/).
import {el, pill} from '../components.js';
import {accountCardOf, isSubmitted} from '../session-state.js';
import {KNOCKOUT} from '../knockout.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {openMatchCheck} from './match-check.js';
import {reasonFor} from '../reason-words.js';
import {formGone} from './session-needs.js';  // cycle by design: used inside functions only

// "Form completion", as on the website: where, "16 / 17 required fields" and the bar always; the fields folded under
// them: what's left first, then each filled one with its time since the fill started (the first field filled).
// "Before you submit": what decides an application more than the CV, from what the form says is still open. The knockout questions (a hiring system can be set to
// reject on them: private research jobadabra-lab:docs/research/ats-reddit-2026-10.md) and which CV goes in: the general one, or one tailored to this job, with a way to tailor it.
const fullKey = url => String(url || '').trim().replace(/\/$/, '');
let beforeRead = 0; // only the latest card draw may use an asynchronous letter/CV answer
const cvSeen = new Map();   // job url → {at, info}
async function cvInfo(url, given) {
  const key = `${url}:${!!given}`, known = cvSeen.get(key);
  if (known && Date.now() - known.at < 4000) return known.info;
  const info = await window.pilot.cvOf(url, !!given).catch(() => null);
  cvSeen.set(key, {at: Date.now(), info});
  return info;
}
// A knockout: the English words, or the AI that read the form in any language (extension/page/categories.js -> the panel's `knockouts`).
function showBefore(item, left, account = false, aiKnockouts = [], letterGiven = false, letterAsked = false) {
  const read = ++beforeRead;
  const knockouts = left.filter(label => KNOCKOUT.test(label) || aiKnockouts.includes(label));
  const submitted = isSubmitted(item);
  show($('ss-before-knock'), !submitted && knockouts.length > 0);
  if (knockouts.length) {
    $('ss-before-knock-title').textContent = `${knockouts.length} question${knockouts.length === 1 ? '' : 's'} can reject you automatically, if the employer set a rule`;
    $('ss-before-knock-list').textContent = `Answer ${knockouts.length === 1 ? 'it' : 'them'} yourself, truthfully: ${knockouts.slice(0, 3).map(label => label.replace(/\s*\*\s*$/, '')).join(' · ')}${knockouts.length > 3 ? ' …' : ''}`;
  }
  const job = shared.allJobs.find(candidate => fullKey(candidate.url) === fullKey(item.url));
  show($('ss-before-cv'), false);
  show($('ss-before-letter'), false);
  // A sign-in or sign-up page is not the application: no CV goes there (owner, 8 Oct 2026).
  if (submitted || !item.url || account) return show($('ss-before'), !submitted && knockouts.length > 0);
  cvInfo(item.url, letterGiven).then(info => {
    if (!info || read !== beforeRead) return;
    const letter = info.coverLetterStatus;
    const letterMissing = letterAsked && letter && !letter.ready;
    show($('ss-before-letter'), !!letterMissing);
    if (letterMissing) {
      $('ss-before-letter-title').textContent = 'HIGH PRIORITY · Cover letter';
      $('ss-before-letter-sub').textContent = letter.reason;
      $('ss-before-letter-btn').textContent = letter.action;
      $('ss-before-letter-btn').onclick = () => import('./settings.js').then(page => page.openSetting('letter'));
      $('ss-form-pill').replaceChildren(pill('Cover letter needs setup', 'warn'));
      $('ss-form-card').classList.remove('is-ready');
    }
    show($('ss-before-cv'), true);
    $('ss-before-cv-mark').textContent = info.tailored ? '✓' : '○';
    // Why (27 Oct 2026, owner): the form's panel no longer tailors; its "Tailor in Jobadabra" opens this card, and a tailored CV restarts the form (lib/tailored-restart.js).
    $('ss-before-cv-title').textContent = info.tailored ? 'A CV tailored to this job is ready' : info.working ? 'Tailoring your CV for this job…' : job?.code ? 'This form gets your general CV' : 'This job is not in your list yet';
    $('ss-before-cv-sub').textContent = info.tailored ? 'The form fills again from the start with it.' : info.working ? 'About 1–2 minutes. Then the form fills again from the start with it.'
      : job?.code ? 'A CV written for the job gets noticeably more replies than a general one.' : 'Add it to tailor a CV for it (the posting is read and scored, like Jobs → Add by link).';
    const compare = $('ss-before-match-btn');
    show(compare, !!job?.code);
    compare.onclick = () => openMatchCheck(job);
    const button = $('ss-before-cv-btn');
    show(button, !info.tailored && !info.working);
    button.disabled = false;
    button.textContent = job?.code ? 'Tailor my CV' : 'Add this job';
    button.onclick = async () => {
      button.disabled = true;
      if (!job?.code) {   // the panel's old "Add this job", now here: once the job is listed, the same button tailors
        button.textContent = 'Adding…';
        const added = await window.pilot.importJob(String(item.url).split('#')[0]).catch(error => ({ok: false, text: error.message}));
        if (added?.ok) { try { const fresh = (await window.pilot.jobs()).jobs; if (Array.isArray(fresh)) shared.allJobs = fresh; } catch {} }
        button.textContent = added?.ok ? 'Tailor my CV' : 'Retry';
        button.disabled = false;
        if (added?.ok) showBefore(item, left, account, aiKnockouts, letterGiven, letterAsked);
        else button.title = added?.text || '';
        return;
      }
      button.textContent = 'Tailoring… (about 1–2 min)';
      const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`, [job.url, item.url]);
      button.textContent = result.ok ? 'Tailored ✓' : 'Retry';
      button.disabled = !!result.ok;
      cvSeen.delete(`${item.url}:false`); cvSeen.delete(`${item.url}:true`);
      if (result.ok) showBefore(item, left, account, aiKnockouts, letterGiven, letterAsked);
    };
    show($('ss-before'), true);
  });
  show($('ss-before'), knockouts.length > 0);
}
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function showFormCard(item, state) {
  const card = $('ss-form-card');
  card.hidden = !state?.total || formGone(item);
  if (card.hidden) return;
  // A sign-in or sign-up page is the account step, not the application: its own title, count and what is left for you (never "Ready to submit").
  const account = accountCardOf(item, state);
  $('ss-form-title').textContent = account ? account.title : 'Form completion';
  const done = state.total - state.left;
  $('ss-form-pill').replaceChildren(account ? pill(account.pill.text, account.pill.tone, {dot: true, title: 'The account step: what the page asks of you before the application form'}) : isSubmitted(item) ? pill('Submitted', 'good', {dot: true})
    : state.ready ? pill('Ready to submit', 'good', {dot: true})
    : state.needs && !state.left ? pill(`Needs you: ${state.needs === '1' ? 'see what the form asks' : state.needs}`, 'warn', {title: 'Every counted field is filled, but the page still asks for something only you can give'})   // the AI's veto (a consent link, a picklist the count cannot see)
    : pill(`${state.left} remaining`, 'warn', {title: `${state.total - state.left} of ${state.total} required fields filled (the ring on the form lists the rest)`}));
  const count = $('ss-form-count');
  count.replaceChildren(el('b', '', String(done)), el('span', '', account ? account.count : ` of ${state.total} required fields`));
  $('ss-form-bar').style.width = `${Math.round(100 * done / state.total)}%`;
  card.classList.toggle('is-ready', !!state.ready);
  showBefore(item, state.pending || state.missing || [], !!state.account, state.knockouts || [], state.letterGiven === true, state.letterAsked === true);
  // An extension older than 0.8.12 sends no filled fields: then only what's left.
  const filled = [...(state.filled || [])].sort((a, b) => a.at - b.at);
  const left = account ? account.left : state.pending || state.missing || [];
  const start = filled.find(field => field.at)?.at || 0;
  $('ss-form-more').hidden = !filled.length && !left.length;
  const leftCount = Math.max(left.length, state.left);
  const leftText = leftCount ? `${leftCount} ${item.status === 'running' ? 'to go' : 'left'}` : '';
  $('ss-form-summary').textContent = filled.length ? `Show the ${filled.length} filled field${filled.length === 1 ? '' : 's'}${leftText ? ` and ${leftText}` : ''}`
    : `Show the ${leftText}`;
  // Who filled it: you (after the fill was over) or the fill (Claude, the extension); the time only when the app saw it.
  const row = (kind, time, mark, label, by = '') => {
    const li = el('li', kind);
    const text = el('span', 'ss-form-label', label);
    text.title = label;
    li.append(el('span', 'ss-form-time', time), el('b', 'ss-form-mark', mark), text);
    if (by) li.append(el('span', 'ss-form-by', by));
    return li;
  };
  $('ss-form-fields').replaceChildren(
    ...left.map((label, index) => { const li = row('is-left', '', '○', label, account && index === 0 && state.needs ? 'for you' : ''); li.title = reasonFor(state, label) || ''; return li; }),   // why the fill left it (reason-words.js)
    ...filled.map(field => row(field.by === 'you' ? 'is-filled is-yours' : 'is-filled', field.at ? clock(Math.max(0, field.at - start)) : '', '✓', field.label,
      field.by === 'you' ? 'you' : '')));
}
