// CV match dialog (lib/match-check.js): this job's posting against the CV, on request. Opened from the Jobs ⋯ menu and from the session card.
import {el, pill} from '../components.js';
import {costText, dollars} from '../ai-cost.js';
import {$, message, runWhen, show} from './core.js';

const FOUND = {found: ['Stated', 'good'], implied: ['Only implied', 'warn'], bank: ['In your bank', 'good'], missing: ['Not mentioned', 'bad']};
const KNOCK = {ok: ['Supported', 'good'], check: ['Confirm it', 'warn'], conflict: ['May conflict', 'bad']};
let current = null;

function row(label, tone, title, detail) {
  const li = el('li', 'cvc-check');
  const body = el('div');
  body.append(el('b', '', title));
  if (detail) body.append(el('span', 'muted small', detail));
  li.append(pill(label, tone), body);
  return li;
}
function showResult(data) {
  const result = data?.result;
  show($('match-result'), !!result);
  $('match-run').textContent = result ? 'Check again' : 'Check the match';
  if (!result) return;
  $('match-grade').textContent = result.grade;
  $('match-grade').className = `cvc-score ${result.grade <= 'A' ? 'good' : result.grade === 'B' ? 'ok' : 'low'}`;
  $('match-summary').textContent = result.summary;
  $('match-sub').textContent = `${data.stale ? 'Made with an earlier CV · ' : ''}${runWhen(data.at)} ${costText(result.usd, usd => ` · ${dollars(usd)}`)}`;
  $('match-musts').replaceChildren(...result.musts.map(item => row(...FOUND[item.status], item.term, item.evidence)));
  show($('match-knock-h'), result.knockouts.length > 0);
  $('match-knocks').replaceChildren(...result.knockouts.map(item => row(...KNOCK[item.status], item.requirement, item.note)));
  show($('match-advice-h'), result.advice.length > 0);
  $('match-advice').replaceChildren(...result.advice.map(text => el('p', 'cvc-fix', text)));
  show($('match-tailor'), result.musts.some(item => item.status !== 'found') && !!current?.tailor);
}
export async function openMatchCheck(job, {tailor = null} = {}) {
  current = {job, tailor};
  $('match-job').textContent = `${job.title} · ${job.company}`;
  message('match-message', '');
  showResult(await window.pilot.matchSaved(job.code).catch(() => null));
  $('match-cost').textContent = 'Reads the posting and your CV once.';
  if (!$('match-dialog').open) $('match-dialog').showModal();
}
export function init() {
  $('match-close').addEventListener('click', () => $('match-dialog').close());
  $('match-run').addEventListener('click', async () => {
    const button = $('match-run'), label = button.textContent;
    button.disabled = true;
    button.textContent = 'Comparing… (about 30 s)';
    message('match-message', '');
    const result = await window.pilot.matchCheck(current.job.code);
    button.disabled = false;
    button.textContent = label;
    if (!result.ok) return message('match-message', result.error, 'error');
    showResult(result);
  });
  $('match-tailor').addEventListener('click', async () => {
    $('match-dialog').close();
    await current.tailor?.();
  });
}
