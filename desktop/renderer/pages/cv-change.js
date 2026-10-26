// A replaced CV and what follows it.
import {ai} from '../ai-name.js';
import {costText, dollars} from '../ai-cost.js';
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, message, show} from './core.js';
import {showOnTab} from './tab-part.js';
import {loadCvSetting} from './profile.js';
import {byStore} from '../store-words.js';
import {sayRefused} from './startup.js';
import {jobPlace} from '../targets.js';

// ---------- a replaced CV: what follows it (suggested Profile edits, tailoring base, unsent kits), never a rebuild ----------
let cvSuggestions = [];
const KITS_SHOWN = 3;
// The verdict banner and the status pills on the dialog's rows.
function setVerdict(tone, title, text) {
  const box = $('cv-verdict');
  box.className = `alert tone-${tone} cv-verdict`;
  box.firstElementChild.replaceWith(icon(tone === 'good' ? 'check-circle' : 'info'));
  $('cv-verdict-title').textContent = title;
  $('cv-verdict-text').replaceChildren(...text.split('\n').flatMap((line, i) => (i ? [document.createElement('br'), line] : [line])));
  show(box, true);
  show($('cv-profile-text'), false);
}
function setPill(id, text, tone) { $(id).replaceChildren(pill(text, tone)); }
export async function showCvChanged() {
  const change = await window.pilot.cvChange();
  $('cv-changed-text').textContent = `Your CV changed${change.at ? ` on ${new Date(change.at).toLocaleDateString()}` : ''}: review what it changes.`;
  showOnTab($('cv-changed'), !!change.at);
  show($('strategy-cv-changed'), !!change.at);
}
export async function openCvChange() {
  const change = await window.pilot.cvChange();
  // What applying Profile edits costs: every scored job is re-scored over the next searches.
  $('cv-impact').textContent = '';
  show($('cv-impact'), false);
  window.pilot.strategyData().then(data => {
    if (!data?.ok || !data.scored) return;
    const searches = Math.max(1, Math.ceil(data.scored / 60));
    $('cv-impact').textContent = `Applying Profile edits re-scores ${data.scored} jobs over the next ${searches} search${searches === 1 ? '' : 'es'} ` +
      `${data.counts?.kits ? `; ${data.counts.kits} unsent kits were drafted with the old Profile` : ''}.`;
  }).catch(() => {});
  $('cv-dialog-name').textContent = change.name || 'your CV';
  $('cv-dialog-sub').textContent = change.previous === change.name ? 'New upload · same file name as the previous CV' : `New upload${change.previous ? ` · replaces ${change.previous}` : ''}`;
  show($('cv-verdict'), false);
  show($('cv-profile-text'), true);
  $('cv-profile-status').textContent = 'Not compared yet';
  $('cv-compare').textContent = 'Compare with my Profile';
  show($('cv-cost'), true);
  setPill('cv-profile-pill', 'Not compared', 'neutral');
  $('cv-suggestions').replaceChildren();
  show($('cv-apply-row'), false);
  show($('cv-profile-status').parentElement, true);
  message('cv-review-message', '');
  $('cv-compare').disabled = !change.comparable;
  if (!change.comparable) {
    $('cv-profile-text').textContent = `The previous CV is not on this computer, so there is nothing to compare. ${byStore('Edit the Profile in Notion if needed.', 'Edit your Profile if needed.')}`;
    show($('cv-profile-status').parentElement, false);
    setPill('cv-profile-pill', 'Edit in Notion', 'neutral');
  }
  $('cv-base-text').textContent = change.base ? 'Made from the previous CV. Read the new one so tailored CVs start from it.' : 'Read from this CV on your first Tailor CV. Nothing to do.';
  setPill('cv-base-pill', change.base ? 'To update' : 'Nothing to do', change.base ? 'warn' : 'neutral');
  show($('cv-base-actions'), change.base);
  const kits = shared.allJobs.filter(job => job.kit && job.code && job.status !== 'applied' && job.status !== 'dismissed');
  let showAll = false;
  const draw = () => {
    const shown = showAll ? kits : kits.slice(0, KITS_SHOWN);
    $('cv-kits').replaceChildren(...shown.map(job => {
      const row = el('div', 'cv-kit');
      const redraft = el('button', 'ghost with-icon', 'Redraft');
      redraft.prepend(icon('refresh'));
      redraft.addEventListener('click', async () => {
        redraft.disabled = true;
        redraft.textContent = 'Redrafting…';
        const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
        redraft.textContent = result.ok ? '✓ Redrafted' : 'Retry';
        sayRefused('Redraft did not start', result, jobPlace(job));   // no AI credit, trial over (renderer/refusal.js): why, not a bare Retry
        redraft.disabled = !!result.ok;
      });
      const name = el('div');
      name.append(el('b', '', job.title), el('span', 'muted small', job.company));
      row.append(name, redraft);
      return row;
    }));
    const more = $('cv-kits-more');
    show(more, kits.length > KITS_SHOWN);
    more.textContent = showAll ? 'Show fewer' : `Show all ${kits.length} kits`;
  };
  $('cv-kits-more').onclick = () => { showAll = !showAll; draw(); };
  $('cv-kits-count').textContent = String(kits.length);
  draw();
  show($('cv-kits-row'), kits.length > 0);
  if (!$('cv-dialog').open) $('cv-dialog').showModal();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('cv-changed-open').addEventListener('click', openCvChange);
  $('cv-compare').addEventListener('click', async () => {
    const button = $('cv-compare');
    button.disabled = true;
    button.classList.add('busy');
    message('cv-review-message', ai('{AI} is comparing your CVs with your Profile… (about 30 s)'), 'waiting');
    const result = await window.pilot.cvReview();
    button.disabled = false;
    button.classList.remove('busy');
    if (!result.ok) return message('cv-review-message', result.error, 'error');
    cvSuggestions = result.suggestions;
    message('cv-review-message', '');
    $('cv-profile-status').textContent = `Comparison complete${costText(result.usd, usd => ` · Actual cost ${dollars(usd)}`)}`;
    $('cv-compare').textContent = 'Compare again';
    show($('cv-impact'), cvSuggestions.length > 0);   // what applying costs matters only when there is something to apply
    if (cvSuggestions.length) {
      setVerdict('info', `${cvSuggestions.length} Profile edit${cvSuggestions.length === 1 ? '' : 's'} suggested`, `${result.summary}\nPick the ones you want below; nothing is written until you apply.`);
      setPill('cv-profile-pill', `${cvSuggestions.length} to review`, 'warn');
    } else {
      setVerdict('good', 'No Profile edits needed', 'Your new CV matches the previous one in substance.\nRoles, dates, titles, skills, achievements and contact details are unchanged.');
      setPill('cv-profile-pill', 'Unchanged', 'neutral');
    }
    const label = {update: ['Update', 'info'], add: ['Add', 'good'], remove: ['Remove', 'bad']};
    $('cv-suggestions').replaceChildren(...cvSuggestions.map(s => {
      const row = el('label', 'radio cv-suggestion');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = s.kind !== 'remove';  // removals are opt-in
      box.dataset.id = s.id;
      const body = el('span');
      body.append(pill(label[s.kind][0], label[s.kind][1]), ' ');
      if (s.kind !== 'add') body.append(el('s', 'muted', s.block.text), s.kind === 'update' ? ' → ' : '');
      if (s.kind !== 'remove') body.append(el('b', '', s.text));
      if (s.kind === 'add') body.append(el('span', 'muted', ` (after “${s.block.text.slice(0, 60)}”)`));
      body.append(el('div', 'muted small', s.why));
      row.append(box, body);
      return row;
    }));
    show($('cv-apply-row'), cvSuggestions.length > 0);
  });
  $('cv-apply').addEventListener('click', async () => {
    const picked = new Set([...$('cv-suggestions').querySelectorAll('input:checked')].map(box => Number(box.dataset.id)));
    const accepted = cvSuggestions.filter(s => picked.has(s.id));
    if (!accepted.length) return message('cv-review-message', 'Nothing selected.', 'waiting');
    $('cv-apply').disabled = true;
    const result = await window.pilot.cvApply(accepted);
    $('cv-apply').disabled = false;
    if (!result.ok) return message('cv-review-message', result.error, 'error');
    message('cv-review-message', result.failed.length ? `${result.applied} applied; not applied: ${result.failed.join('; ')}`
      : `✓ ${result.applied} change${result.applied === 1 ? '' : 's'} saved to your Profile${byStore(' in Notion', '')}.`, result.failed.length ? 'error' : 'ok');
    if (!result.failed.length) { $('cv-suggestions').replaceChildren(); show($('cv-apply-row'), false); setPill('cv-profile-pill', '✓ Updated', 'good'); setVerdict('good', 'Profile updated', byStore('Your selected changes are saved in Notion.', 'Your selected changes are saved.')); }
  });
  $('cv-base-read').addEventListener('click', async () => {
    const button = $('cv-base-read');
    button.disabled = true;
    button.textContent = 'Reading your CV… (about 30 s)';
    const result = await window.pilot.importCv();
    button.textContent = result.ok ? `✓ Done${costText(result.usd, usd => ` (${dollars(usd)})`)}` : 'Retry';
    button.disabled = !!result.ok;
    if (result.ok) setPill('cv-base-pill', '✓ Updated', 'good');
    loadCvSetting();
  });
  $('cv-later').addEventListener('click', () => { $('cv-dialog').close(); showCvChanged(); });
  $('cv-done').addEventListener('click', async () => { await window.pilot.cvChangeDone(); $('cv-dialog').close(); showCvChanged(); });
}
