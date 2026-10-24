// Jobs page, Log a message: the recruiter-lead dialog (screenshots, confirm step, job picker) and wireLead(). Guarded by: test/lead-confirm.test.js.
import {el, pill, tile} from '../components.js';
import * as confirmStep from '../lead-confirm.js';
import {shared} from './shared.js';
import {showJob} from './activity.js';
import {jobActions, jobHeadline} from '../job-link.js';
import {$, message, osPick} from './core.js';
import {loadJobs} from './jobs.js';
import {setFilters} from './jobs-filter-menu.js';
import {storeName} from '../store-words.js';

// A recruiter's message: Claude reads it into a recruiter lead in Notion (like /add <message> in Telegram).
let leadSteps = [];  // the Log box's steps so far ({text, at}), from the engine (lead-confirm.js addStep)
let leadRunning = false;  // a log is being read now (the dialog may have been closed and reopened)
// Up to 5 screenshots per log (a long LinkedIn chat): read together, in this order, and kept on the job's page.
const MAX_SHOTS = 5;
let leadShots = [];  // [{name, type, data (base64)}]
function renderShots() {
  $('lead-shots').replaceChildren(...leadShots.map((shot, i) => {
    const box = el('div', 'attachment');
    const remove = el('button', 'soft-button', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => { leadShots.splice(i, 1); renderShots(); });
    box.append(Object.assign(document.createElement('img'), {src: `data:${shot.type};base64,${shot.data}`, alt: `Screenshot ${i + 1}`}),
      el('span', 'attachment-name', `${leadShots.length > 1 ? `${i + 1}. ` : ''}${shot.name}`), remove);
    return box;
  }));
  $('lead-shots').hidden = !leadShots.length;
  $('lead-shot-add').disabled = $('lead-shot-paste').disabled = leadShots.length >= MAX_SHOTS;
}
function setLeadShot(shot) {
  if (leadShots.length >= MAX_SHOTS) { leadResult('info', `Up to ${MAX_SHOTS} screenshots`, 'Remove one to add another.'); return; }
  leadShots.push(shot);
  renderShots();
}
function readShot(file) {  // a File from paste, drop or the picker
  if (!file || !/^image\//.test(file.type)) return false;
  const reader = new FileReader();
  reader.onload = () => { const url = String(reader.result); setLeadShot({name: file.name || 'screenshot.png', type: file.type, data: url.slice(url.indexOf(',') + 1)}); };
  reader.readAsDataURL(file);
  return true;
}
// Step 2, the confirmation: what Claude read, with what it couldn't see asked (renderer/lead-confirm.js).
let leadProposal = null, leadState = null;
const localDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function leadStep2(on) {
  $('lead-compose').hidden = on;
  $('lead-confirm').hidden = !on;
  $('lead-back').hidden = !on;
  $('lead-cancel').hidden = on;
  if (!on) { leadProposal = leadState = null; $('lead-go').textContent = 'Log activity'; }
}
function showConfirm(proposal, state = null) {
  leadProposal = proposal;
  leadState = state || confirmStep.initial(proposal);
  fillJobChoices();
  const fields = proposal.fields || {};
  const {title, meta} = confirmStep.found(proposal);
  $('lead-found-tile').replaceChildren(tile(proposal.new ? 'inbox' : 'briefcase', 'info'));
  $('lead-found-title').textContent = title;
  $('lead-found-meta').textContent = meta;
  const option = (value, text) => Object.assign(document.createElement('option'), {value, textContent: text});
  $('lead-kind').replaceChildren(...(fields.kind?.options || Object.keys(confirmStep.KIND_LABEL)).map(k => option(k, confirmStep.KIND_LABEL[k] || k)));
  $('lead-kind').value = leadState.values.kind || '';
  $('lead-channel-other').value = '';
  const started = fields.started || {};
  $('lead-started-label').textContent = started.question || 'When did it start?';
  $('lead-started').value = leadState.values.started || '';
  $('lead-started').max = localDay();
  $('lead-years').hidden = !started.years?.length;
  $('lead-years').replaceChildren(...(started.years || []).map(year => Object.assign(document.createElement('button'),
    {type: 'button', textContent: String(year), onclick: () => leadSet('started', confirmStep.withYear(started, year))})));
  $('lead-interview-label').textContent = fields.interview?.question || 'When is the call?';
  $('lead-interview').value = leadState.values.interview || '';
  $('lead-last-label').textContent = fields.last?.question || 'When was the last message?';
  $('lead-last').value = leadState.values.last || '';
  $('lead-last').max = localDay();
  $('lead-company').value = leadState.values.company || '';
  $('lead-agency').value = leadState.values.agency || '';
  $('lead-started-hint').textContent = confirmStep.startedHint(proposal.new);
  leadStep2(true);
  renderConfirm();
}
function leadSet(name, value) { leadState = confirmStep.set(leadState, name, value); renderConfirm(); }
// "Which job is this?": the likely ones (from the engine), a new job, your other jobs.
let leadJobChoices = [];
let leadJobActive = -1;
function closeJobChoices() {
  $('lead-job-options').hidden = true;
  $('lead-job').setAttribute('aria-expanded', 'false');
  $('lead-job').removeAttribute('aria-activedescendant');
  leadJobActive = -1;
}
function showJobChoices() {
  const list = $('lead-job-options');
  const groups = confirmStep.searchJobChoices(leadJobChoices, $('lead-job').value);
  const buttons = [];
  list.replaceChildren(...(groups.length ? groups.flatMap(({group, options}) => [
    ...(group ? [Object.assign(document.createElement('div'), {className: 'lead-job-group', textContent: group})] : []),
    ...options.map(option => {
      const button = Object.assign(document.createElement('button'), {type: 'button', className: 'lead-job-option',
        id: `lead-job-option-${buttons.length}`, textContent: option.text});
      button.setAttribute('role', 'option');
      button.addEventListener('click', () => { closeJobChoices(); pickJob(option.value); });
      buttons.push(button);
      return button;
    })]) : [Object.assign(document.createElement('div'), {className: 'lead-job-empty', textContent: 'No matching jobs'})]));
  leadJobActive = -1;
  list.hidden = false;
  $('lead-job').setAttribute('aria-expanded', 'true');
  $('lead-job').removeAttribute('aria-activedescendant');
}
function fillJobChoices() {
  leadJobChoices = confirmStep.jobChoices(leadProposal.fields?.job?.candidates || [], shared.allJobs);
  $('lead-job').value = '';
  closeJobChoices();
}
// The engine's steps with a timer while it reads (step 1), proposes again for a job you picked, or writes (step 2).
async function working(first, task) {
  leadRunning = true;
  $('lead-go').disabled = true;
  const started = Date.now();
  leadSteps = [{text: first, at: started}];
  const tick = () => {
    const rows = confirmStep.stepRows(leadSteps, Date.now()), current = rows.at(-1);
    message('lead-message', `${current.text}… ${Math.round((Date.now() - started) / 1000)} s`, 'waiting');
    $('lead-steps').hidden = rows.length < 2;
    $('lead-steps').replaceChildren(...rows.slice(0, -1).map(row => {  // the finished ones: the current step is the line above
      const item = document.createElement('li');
      item.append(Object.assign(document.createElement('span'), {textContent: row.text}),
        Object.assign(document.createElement('time'), {textContent: `${row.seconds} s`}));
      return item;
    }));
  };
  tick();
  const timer = setInterval(tick, 1000);
  try { return await task(); } finally { clearInterval(timer); leadRunning = false; $('lead-go').disabled = false; message('lead-message', ''); $('lead-steps').hidden = true; }
}
// The job you picked: the same reading proposed again for it (no second AI reading); what you confirmed is kept.
async function pickJob(target) {
  if (!target || !leadProposal) return;
  const text = $('lead-text').value.trim();
  const next = await working(`Reading your jobs in ${storeName()}`, () => window.pilot.proposeLead(text, [], target, leadProposal));
  if (!next.ok) { leadResult('warn', "Couldn't use that job", String(next.text || '').replace(/^\S+\s/, '')); return; }
  showConfirm(next, confirmStep.carry(leadState, next));
}
// Every field's mark (please check / needs an answer / ✓), the choices shown, and the Save button's words.
function renderConfirm() {
  if (!leadProposal) return;
  const fields = leadProposal.fields || {}, v = leadState.values;
  const left = confirmStep.pending(leadProposal, leadState, localDay());
  const choosing = confirmStep.choosingJob(leadProposal, leadState);
  const asked = fields.job?.state === 'ask';
  $('lead-found').hidden = asked;
  const change = Object.assign(document.createElement('button'), {type: 'button', className: 'link',
    textContent: leadState.picking ? 'Keep this job' : 'Change'});
  change.addEventListener('click', () => { leadState = {...leadState, picking: !leadState.picking}; $('lead-job').value = ''; closeJobChoices(); renderConfirm(); });
  $('lead-found-flag').replaceChildren(...(asked ? [] : [pill('Confirmed', 'good', {dot: true}), change]));
  $('lead-job-hint').textContent = asked ? 'Several of your jobs are from this recruiter or company: pick one, or a new job. The details follow your pick.'
    : 'Pick the job it is about, or a new job. The details follow your pick.';
  document.querySelectorAll('#lead-confirm .lead-field[data-field]').forEach(box => {
    const name = box.dataset.field, field = fields[name];
    if (name === 'job') {
      box.hidden = !choosing;
      box.classList.toggle('is-ask', choosing);
      box.querySelector('.lead-flag').replaceChildren(pill('Needs an answer', 'warn'));
      return;
    }
    if (choosing) { box.hidden = true; return; }
    if (name === 'first') { box.hidden = !leadProposal.new; return; }
    box.hidden = !field || (name === 'origin' && !confirmStep.originShown(leadProposal, leadState)) || (name === 'interview' && !confirmStep.interviewShown(leadProposal, leadState));
    if (box.hidden) return;
    const waiting = left.find(item => item.name === name);
    box.classList.toggle('is-check', waiting?.why === 'check');
    box.classList.toggle('is-ask', !!waiting && waiting.why !== 'check');
    const flag = box.querySelector('.lead-flag');
    if (!waiting) flag.replaceChildren(...(field.state === 'ok' || !leadState.confirmed.includes(name) ? [] : [pill('Confirmed', 'good', {dot: true})]));
    else if (waiting.why === 'check') {
      const ok = Object.assign(document.createElement('button'), {type: 'button', className: 'link', textContent: 'Looks right'});
      ok.addEventListener('click', () => leadSet(name));
      flag.replaceChildren(pill('Please check', 'warn'), ok);
    } else flag.replaceChildren(pill(waiting.why === 'future' ? 'In the future' : 'Needs an answer', 'warn'));
  });
  $('lead-pair-box').hidden = choosing || (!fields.company && !fields.agency);
  $('lead-channel').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.channel === v.channel));
  $('lead-channel-other').hidden = v.channel !== 'Other';
  $('lead-channel-hint').textContent = confirmStep.channelHint(fields.channel, v.channel);
  if ($('lead-started').value !== (v.started || '')) $('lead-started').value = v.started || '';  // a year picked fills the date
  $('lead-years').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', (v.started || '').startsWith(b.textContent)));
  const said = fields.interview?.as_written ? `The message says "${fields.interview.as_written}". ` : '';
  $('lead-interview-hint').textContent = said + (v.kind === 'Interview scheduled' ? 'A booked call needs its date and time.'
    : 'Leave empty if no time is fixed yet.');
  if (fields.last) $('lead-last-hint').textContent = confirmStep.lastHint(fields.last, v.last);
  if (fields.origin) {
    $('lead-origin').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.origin === v.origin));
    $('lead-origin-hint').textContent = confirmStep.originHint(fields.origin, leadState);
  }
  const changing = confirmStep.changes(leadProposal, leadState);
  $('lead-changes').hidden = !changing.length;
  $('lead-changes-list').replaceChildren(...changing.map(change => {
    const item = document.createElement('li');
    const what = Object.assign(document.createElement('b'), {textContent: change.name});
    item.append(what, ` ${change.from} → ${change.to}`);
    if (change.note) item.append(Object.assign(document.createElement('span'), {className: 'muted small', textContent: change.note}));
    return item;
  }));
  $('lead-agree').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.agree === v.agree));
  if (fields.agree) $('lead-agree-hint').textContent = confirmStep.agreeHint(fields.agree, v.agree, leadProposal.new);
  $('lead-first').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.first === leadState.first));
  $('lead-first-hint').textContent = confirmStep.firstHint(v.channel, leadState.first, leadState.other);
  $('lead-go').textContent = confirmStep.saveLabel(left);
}
function clearLeadShot() { leadShots = []; renderShots(); $('lead-shot-file').value = ''; }
function leadResult(tone, title, text, pick = false) {
  $('lead-result').hidden = !title;
  $('lead-result').className = `alert tone-${tone}`;
  $('lead-result-title').textContent = title || '';
  $('lead-result-text').textContent = text || '';
  $('lead-result-pick').hidden = !pick;
  $('lead-result').querySelector('.alert-actions')?.remove();
}
// Link to job: found automatically (default), a new job, or one of the applications in Notion.
function leadTargets() {
  const tracked = shared.allJobs.filter(job => job.stage && !['Dismissed', 'Closed'].includes(job.stage))
    .sort((a, b) => `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`));
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  const group = document.createElement('optgroup');
  group.label = 'Your applications';
  tracked.forEach(job => group.append(option(job.url, `${job.company || job.via || '—'} · ${job.title} (${job.stage})`)));
  $('lead-target').replaceChildren(option('', 'Choose the job…'),
    option('new', 'Not in my list yet: add it from these details'), ...(tracked.length ? [group] : []));
}
// "Find the job automatically" (ticked by default): untick it to choose the job yourself.
function setAuto(on, locked = false) {
  $('lead-auto').checked = on;
  $('lead-target-box').hidden = on;
  // Opened on a job Focus already knows: guessing which job it is would only undo that.
  $('lead-auto-row').hidden = locked;
}
const leadTarget = () => confirmStep.targetOf($('lead-auto').checked, $('lead-target').value);
// The Log box, opened on one job (Focus → Add details): its "Which job?" already set to it.
export function openLogFor(url, label = '') {
  $('lead-open').click();
  if (!url) return;
  setAuto(false, true);
  let chosen = [...$('lead-target').options].find(o => o.value === url);
  if (!chosen) $('lead-target').append(chosen = Object.assign(document.createElement('option'), {value: url}));
  chosen.textContent = label || chosen.textContent.replace(/\s*\(.*\)$/, '');
  $('lead-target').value = url;
}

// The Log-a-message dialog's wiring, called once from init().
export function wireLead() {
  $('lead-open').addEventListener('click', () => {
    if (!leadRunning) message('lead-message', '');  // a log still running keeps its step and timer
    leadResult('', '');
    if (!leadRunning && !leadProposal) leadStep2(false);  // an unconfirmed reading stays until Back or a save
    $('lead-go').disabled = leadRunning;
    leadTargets();
    if (!leadRunning && !leadProposal) setAuto(true);
    $('lead-dialog').showModal();
    $('lead-text').focus();
  });
  window.pilot.onLeadStep(text => { leadSteps = confirmStep.addStep(leadSteps, text, Date.now()); });
  $('lead-shot-add').addEventListener('click', () => $('lead-shot-file').click());
  $('lead-shot-file').addEventListener('change', () => { [...$('lead-shot-file').files].forEach(readShot); $('lead-shot-file').value = ''; });
  $('lead-shot-paste').addEventListener('click', async () => {
    const shot = await window.pilot.clipboardImage();
    if (shot) setLeadShot(shot); else leadResult('info', 'No image on the clipboard',
      osPick('Copy a screenshot first (⇧⌘4, then Ctrl-click to copy it), or use Add screenshot.',
        'Copy a screenshot first (Win+Shift+S saves one to the clipboard), or use Add screenshot.'));
  });
  $('lead-dialog').addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) { files.forEach(readShot); event.preventDefault(); }
  });
  $('lead-composer').addEventListener('dragover', event => { event.preventDefault(); $('lead-composer').classList.add('is-drop'); });
  $('lead-composer').addEventListener('dragleave', () => $('lead-composer').classList.remove('is-drop'));
  $('lead-composer').addEventListener('drop', event => {
    $('lead-composer').classList.remove('is-drop');
    const files = [...(event.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) { event.preventDefault(); files.forEach(readShot); }
  });
  $('lead-result-pick').addEventListener('click', () => { setAuto(false); $('lead-target').focus(); $('lead-target').showPicker?.(); });
  $('lead-auto').addEventListener('change', () => setAuto($('lead-auto').checked));
  $('lead-job').addEventListener('focus', showJobChoices);
  $('lead-job').addEventListener('click', () => { if ($('lead-job-options').hidden) showJobChoices(); });
  $('lead-job').addEventListener('input', showJobChoices);
  $('lead-job').addEventListener('keydown', event => {
    const options = [...$('lead-job-options').querySelectorAll('[role="option"]')];
    if (event.key === 'Escape') { closeJobChoices(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if ($('lead-job-options').hidden) showJobChoices();
      const visible = [...$('lead-job-options').querySelectorAll('[role="option"]')];
      if (!visible.length) return;
      leadJobActive = (leadJobActive + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      visible.forEach((button, index) => {
        button.classList.toggle('is-active', index === leadJobActive);
        button.setAttribute('aria-selected', String(index === leadJobActive));
      });
      $('lead-job').setAttribute('aria-activedescendant', visible[leadJobActive].id);
      visible[leadJobActive].scrollIntoView({block: 'nearest'});
    } else if (event.key === 'Enter' && !$('lead-job-options').hidden) {
      event.preventDefault();
      (options[leadJobActive] || (options.length === 1 ? options[0] : null))?.click();
    }
  });
  $('lead-job').addEventListener('blur', () => setTimeout(() => {
    if (!$('lead-job-options').contains(document.activeElement)) closeJobChoices();
  }, 150));
  // Step 2's controls: each change confirms that field.
  $('lead-kind').addEventListener('change', () => leadSet('kind', $('lead-kind').value));
  $('lead-channel').addEventListener('click', event => { const b = event.target.closest('[data-channel]'); if (b) leadSet('channel', b.dataset.channel); });
  $('lead-channel-other').addEventListener('input', () => { leadState.other = $('lead-channel-other').value; renderConfirm(); });
  $('lead-started').addEventListener('input', () => leadSet('started', $('lead-started').value));
  $('lead-interview').addEventListener('input', () => leadSet('interview', $('lead-interview').value));
  $('lead-last').addEventListener('input', () => leadSet('last', $('lead-last').value));
  $('lead-company').addEventListener('input', () => leadSet('company', $('lead-company').value));
  $('lead-agency').addEventListener('input', () => leadSet('agency', $('lead-agency').value));
  $('lead-origin').addEventListener('click', event => { const b = event.target.closest('[data-origin]'); if (b) leadSet('origin', b.dataset.origin); });
  $('lead-agree').addEventListener('click', event => { const b = event.target.closest('[data-agree]'); if (b) leadSet('agree', b.dataset.agree); });
  $('lead-first').addEventListener('click', event => { const b = event.target.closest('[data-first]'); if (b) { leadState.first = b.dataset.first; renderConfirm(); } });
  $('lead-back').addEventListener('click', () => { leadStep2(false); leadResult('', ''); message('lead-message', ''); });
  $('lead-go').addEventListener('click', async event => {
    event.preventDefault();
    if (leadRunning) return;  // one log at a time: reopening the dialog never starts a second one
    const text = $('lead-text').value.trim();
    leadResult('', '');
    if (!leadProposal) {  // step 1: Claude reads it; nothing is written yet
      if (!leadShots.length && text.length < 40) { leadResult('warn', 'Nothing to log yet', 'Paste the whole message, or add a screenshot of it.'); return; }
      if (!$('lead-auto').checked && !leadTarget()) { leadResult('warn', 'Which job is it?', 'Choose the job, or tick "Find the job automatically".'); return; }
      const proposal = await working(leadShots.length > 1 ? `Sending ${leadShots.length} screenshots` : 'Starting the engine',
        () => window.pilot.proposeLead(text, leadShots, leadTarget()));
      if (!proposal.ok) {
        const said = String(proposal.text || '').replace(/^\S+\s/, '');  // without the leading emoji
        const notJob = /doesn't look like a message about a job/.test(said);
        const unsure = /can't tell which company and role/.test(said);
        leadResult('warn', notJob ? 'No job activity found' : unsure ? 'Which job is it?' : "Couldn't log it",
          notJob ? 'This looks like something other than a job (e.g. a services pitch), so nothing was added.' : said, notJob || unsure);
        return;
      }
      showConfirm(proposal);
      return;
    }
    // Step 2: only once every marked detail is confirmed, then it's written with your answers.
    const left = confirmStep.pending(leadProposal, leadState, localDay());
    if (left.length) {
      leadResult('warn', confirmStep.saveLabel(left), 'The marked details were guessed or missing: confirm or fill them in first.');
      document.querySelector(`#lead-confirm .lead-field[data-field="${left[0].name}"]`)?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      return;
    }
    const answers = confirmStep.confirmed(leadProposal, leadState);
    const result = await working(`Saving to ${storeName()}`, () => window.pilot.addLead(text, leadShots,
      leadProposal.target ?? leadTarget(), leadProposal, answers));
    const said = result.text.replace(/^\S+\s/, '');
    if (!result.ok) { leadResult('warn', "Couldn't log it", said); return; }
    leadStep2(false);
    leadResult(/^ℹ️/.test(result.text) ? 'info' : 'good', /^ℹ️/.test(result.text) ? 'Nothing new' : result.job ? jobHeadline(result.job) : 'Logged', said);
    if (/^ℹ️/.test(result.text)) return;
    // The job it created or updated, one click away (its Notion page, or the Jobs list filtered to it).
    if (result.job) $('lead-result-text').after(jobActions(result.job, {openNotion: window.pilot.openNotion,
      show: job => { $('lead-dialog').close(); showJob(job); }}));
    $('lead-text').value = ''; clearLeadShot();
    setFilters(['all']);  // it may be saved (a lead) or applied: show both
    loadJobs();
  });
}
