// Jobs page, the list: renderJobs (rows, filters, row actions), the stuck banner, loading state, kit label. Guarded by: test/count-flash.test.js.
import {ai} from '../ai-name.js';
import {closeMenu, el, isInteractiveTarget, moreButton, pill, tag} from '../components.js';
import {resumeOffered} from '../claude-help.js';
import {columnOf} from '../jobs-board-rules.js';
import {isInbound} from '../origin.js';
import {looksLikeLink, matches} from '../filter.js';
import {fitRing} from '../fit-ring.js';
import {searchingNow} from './jobs-find.js';
import {icon} from '../icons.js';
import {ago, avatar, band, byStat, isStuck, fitTooltip, matchLabel, openMatches, PLACE_UNCLEAR, placeAndMode, prepareState, preparing, shortPlace, sorted, statPressed, statusPill, tags, unscoredWhy, workMode} from '../jobs-view.js';
import {shared} from './shared.js';
import {openActivity} from './activity.js';
import {$, show} from './core.js';
import {openSession} from './session-log.js';
import {SESSION_PILL, refreshSessions, sessionFor, sessionList, sessionsLoaded} from './sessions.js';
import {sayRefused, toastMessage} from './startup.js';
import {openFeedback} from './feedback.js';
import {outcomeChoices, reopenable} from '../outcome-tap.js';
import {scoreBucket} from '../intel.js';
import {askWhy} from './dismiss-reason.js';
import {openMatchCheck} from './match-check.js';
import {jobsState, MORE, pageKey, fullKey} from './jobs-state.js';
import {renderExport} from './jobs-export.js';
import {byStore, storeName} from '../store-words.js';
import {fitDetail} from './jobs-fit.js';
import {openJobPanel, panelUrl} from './job-panel.js';
import {jobsChanged, loadJobs, showJobsData, startedApplying} from './jobs.js';
import {paintViews} from './jobs-views.js';
import {renderFilterMenu} from './jobs-filter-menu.js';
import {renderTalking} from './jobs-talking.js';
import {boardIds, hasViewOption, inFilters, inFiltersLoose, soleFilter} from '../jobs-filters.js';

// Applying, with no session open for it: one to settle (banner on Jobs).
const stuck = job => isStuck(job, entry => sessionList.some(item => pageKey(item.url) === pageKey(entry.url)));
export function renderStuck() {
  // Not before the sessions are known: with none loaded yet every Applying job would look abandoned for a moment.
  const count = sessionsLoaded ? shared.allJobs.filter(stuck).length : 0;
  show($('jobs-stuck'), count > 0);
  $('jobs-stuck-text').textContent = `${count} job${count === 1 ? ' is' : 's are'} still marked Applying but ${count === 1 ? 'has' : 'have'} no open session. Did you submit ${count === 1 ? 'it' : 'them'}?`;
}

// Pill tones: where a job stands, and how it's worked.
const MODE_TONE = {remote: 'good', hybrid: 'info'};
// Work in progress on a job (redrafting its kit, tailoring its CV), shown on its row while the menu is closed.
const busyNotes = new Map();
const claudeStarted = new Set();

document.addEventListener('sessions-loaded', () => renderStuck());
const COUNTS_ALL = new Set(['applied', 'waiting', 'interviews', 'closed']);
export function renderJobs() {
  closeMenu(document.querySelector('.view[data-view="jobs"]'));   // only a menu on this page
  const filters = jobsState.filters;
  const filter = soleFilter(filters);   // '' when several are ticked
  const now = Date.now();
  renderFilterMenu();
  const text = $('filter-text').value.trim();
  // A pasted link finds that job whatever its status; words filter within the chosen status.
  const anyStatus = looksLikeLink(text);
  // The counters count every application (real workload); without one, the ticked filters decide (jobs-filters.js): any of them holds the job;
  // a pasted link finds any job.
  const counted = jobsState.statFilter === 'stuck' ? shared.allJobs.filter(stuck)
    : jobsState.statFilter?.urls ? shared.allJobs.filter(job => jobsState.statFilter.urls.has(fullKey(job.url)))
    : jobsState.statFilter ? byStat(COUNTS_ALL.has(jobsState.statFilter) ? shared.allJobs : openMatches(shared.allJobs), jobsState.statFilter) : null;
  const by = $('sort-by').value;
  const rows = sorted((counted || shared.allJobs)
    .filter(job => (anyStatus && !counted) || (counted ? inFiltersLoose(job, filters, now) : inFilters(job, filters, now)))
    .filter(job => matches(job, text)),
  filter === 'inbound' && !counted && by === 'best' ? 'activity' : by);
  jobsState.visible = rows;   // pages/jobs-export.js saves these
  renderExport();
  renderTalking(!!counted || filters.includes('inbound') || filters.includes('everything') || hasViewOption(filters) || !!text);
  // Jobs found but never scored: the AI step did not run (it is not answering, a limit, no engine). Say so, once, above the list: the
  // rows show "Not scored" and a friend took that for a bug (2 Oct 2026, a search whose AI calls had stalled).
  // A job whose place is unclear is not the AI failing: its row says why (unscoredWhy).
  const unscored = shared.allJobs.filter(job => job.fit == null && job.status === 'unreviewed' && !job.place_unclear).length;
  show($('jobs-unscored'), unscored >= 5 && !searchingNow());   // while the search runs they are being scored: the card on top says so
  $('jobs-unscored-text').textContent = `${unscored} jobs are not scored yet. The AI scores new jobs during each check; if this stays, open Recent activity to see why (Claude Code not answering, a usage limit), or Settings → Connections → AI.`;
  const body = $('jobs-body');
  body.replaceChildren();
  for (const job of rows) {
    const row = el('article', 'job-row');
    Object.assign(row.dataset, {code: job.code || '', url: job.url || ''});   // a notification's click scrolls to it (pages/open-target.js)
    // Fit: a ring filled to the score (the compact list adds "Strong match" under it). A row whose score has a
    // breakdown behind it says so with a caret, and the ring opens it.
    const fit = el('div', `fit-cell ${band(job.fit)}`);
    const ring = fitRing(job.fit);
    const canOpen = job.fit != null && !!job.fit_detail;
    const caret = icon('chevron', `icon fit-caret${canOpen ? '' : ' is-hidden'}`);  // on every row: the rings line up
    const ringRow = el('div', 'fit-ring-row');
    ringRow.append(ring, caret);
    const scoring = job.fit == null && searchingNow() && !job.place_unclear;   // found by the search that is running: its score comes next
    fit.append(ringRow, el('span', 'fit-label', scoring ? 'Scoring…' : matchLabel(job.fit)));
    fit.title = scoring ? 'Being scored now: the fit appears in a moment' : job.fit == null ? unscoredWhy(job) : fitTooltip(job.fit, canOpen ? 'Click to see why' : '');
    const live = sessionFor(job.url);
    const {label: statusLabel, tone: statusTone} = live && !live.endedAt ? SESSION_PILL[live.status] || statusPill(job) : statusPill(job);

    const role = el('div', 'role');
    const titleLine = el('div', 'title-line');
    // An opportunity that found you has no posting (its link is the email or chat): the title opens its Notion page.
    const inNotion = isInbound(job) && !!job.notion_url;
    const link = Object.assign(el('a', '', job.title), {href: '#', title: inNotion ? 'Open in Notion' : 'Open the job\'s details'});
    link.addEventListener('click', event => { event.preventDefault(); if (inNotion) window.pilot.openNotion(job.notion_url, event.metaKey); else openJobPanel(job, 'overview'); });   // the posting itself: the drawer's "Open posting"
    titleLine.append(link, Object.assign(pill(statusLabel, statusTone), {className: `ui-pill tone-${statusTone} status-inline`}));
    role.append(titleLine);
    // Compact list: company · place · mode · age on one line, in place of those columns.
    const meta = el('div', 'meta');
    const small = avatar(job.company);
    const smallBadge = el('span', 'logo', small.initials);
    smallBadge.style.setProperty('--hue', small.hue);
    meta.append(smallBadge, el('b', '', job.company));
    for (const part of [placeAndMode(job.location, job.work_mode), ago(job.first_seen_at)].filter(Boolean)) {
      meta.append(el('span', 'sep', '·'), el('span', '', part));
    }
    role.append(meta);
    role.append(Object.assign(el('div', 'reason', job.reason || ''), job.reason ? {title: job.reason} : {}));   // always: no reason keeps its line, so every row is the same height
    const chips = el('div', 'tags');
    // Three skill tags, the rest behind "+N".
    const skills = tags(job, 8);
    for (const skill of skills.slice(0, 3)) chips.append(tag(skill, {title: skill}));   // one line: a long phrase is cut with … and read in full on hover (style.css .tags)
    if (skills.length > 3) chips.append(tag(`+${skills.length - 3}`, {title: skills.slice(3).join(', ')}));
    // A section of the job's page (kit, rejection review): Notion's page when the store has one, else the job's page here (pages/job-panel.js).
    const openPage = (tab, event) => (job.notion_url ? window.pilot.openNotion(job.notion_url, event?.metaKey) : openJobPanel(job, tab));
    if (job.kit) {
      // Which inputs it was drafted from (src/ai/provenance.py): today's, earlier ones, or unknown (before they were recorded).
      const {label, title} = kitLabel(job.kit_state);
      chips.append(tag(label, {title: `${title} Click to open it${job.notion_url ? ' in Notion' : ''}.`, onClick: event => openPage('kit', event)}));
    }
    if (job.tailored && job.code) chips.append(tag('📄 Tailored CV', {title: 'Your CV tailored to this job, with the changes highlighted',
      onClick: () => window.pilot.openTailoredCv(job.code)}));
    if (job.rejection) chips.append(tag(`🔎 ${job.rejection}`, {title: job.rejection_lesson || 'Why it was rejected',
      onClick: event => openPage('review', event)}));
    if (busyNotes.has(job.url)) chips.append(tag(busyNotes.get(job.url), {busy: true}));
    role.append(chips);   // always: a row without chips keeps the chip line's height, so every row is the same

    const company = el('div', 'company');
    const logo = avatar(job.company);
    const badge = el('span', 'logo', logo.initials);
    badge.style.setProperty('--hue', logo.hue);
    company.append(badge, el('span', 'name', job.company));

    // One line, so every row is as tall as the next: "Moldova · Remote" (the mode's pill after the place; both cut with … and read in full on hover).
    const place = el('div', 'place');
    if (job.location || job.work_mode) {
      const line = el('div', 'place-line');
      line.append(icon(job.location ? 'pin' : 'globe'));
      if (job.location) { const shown = shortPlace(job.location); line.append(Object.assign(el('span', '', shown.text), {title: shown.full || shown.text})); }
      if (job.work_mode) { const mode = workMode(job.work_mode); line.append(pill(mode.label, MODE_TONE[mode.kind] || 'neutral', {title: job.work_mode})); }
      place.append(line);
    }

    const status = el('div', 'status-cell');
    status.append(pill(statusLabel, statusTone));
    // The kit's eligibility verdict: a badge, with the reason on hover.
    if (job.ineligible) {
      const verdict = Object.assign(pill('⛔ Not eligible', 'bad'), {tabIndex: 0});
      verdict.classList.add('tip');
      verdict.dataset.tip = job.ineligible;
      status.append(verdict);
    }
    if (job.place_unclear && job.fit == null) {
      const unclear = Object.assign(pill(PLACE_UNCLEAR, 'warn'), {tabIndex: 0});
      unclear.classList.add('tip');
      unclear.dataset.tip = unscoredWhy(job);
      status.append(unclear);
    }

    const box = el('div', 'row-actions');
    const menu = [];
    // Notion is the source of truth: if it can't be written, nothing changes and the user is told.
    const setStatus = next => async () => {
      const result = await window.pilot.setStatus(job.url, next).catch(error => ({ok: false, error: error.message}));
      if (!result.ok) { toastMessage('Status not changed', result.error || 'Something went wrong.'); return; }
      const stage = result.stage || job.stage;   // what Notion now holds (a dismissed job in process becomes Closed)
      jobsChanged(job, {status: next, stage: next === 'applied' && stage === 'Applying' ? 'Applied' : stage});
      if (next === 'dismissed' && jobsState.statFilter?.urls) jobsState.statFilter.urls.delete(fullKey(job.url));   // a counter's list is a fixed set of jobs: it must let the dismissed one go
      renderJobs();
      if (next === 'dismissed') askWhy(job);   // one optional tap: why (counted with the score band only)
    };
    // Chrome opens the job's form and the extension fills it at once from the kit.
    const fillInChrome = async button => {
      const result = await window.pilot.applyOne(job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode});
      if (result.ok) { shared.openedInChrome.add(pageKey(job.url)); startedApplying(job); renderJobs(); } else if (result.needsExtension || result.cancelled) { /* the install dialog is open (extension-needed.js), or Not now in the first-Apply dialog */ }
      else if (sayRefused('Apply did not start', result)) { /* why, in a pop-up (no AI credit, trial over, no store): never "No link" */ } else if (button) button.textContent = 'No link';
      else toastMessage('Could not open the job', 'It has no link.');
    };
    if (job.status !== 'applied' && job.url && (job.kit || job.ready)) {
      // Stays "Opened" for the session (until marked applied); a click opens it again.
      const opened = shared.openedInChrome.has(pageKey(job.url));
      // The easy way is the main button: Chrome opens the form in a normal tab and the extension fills it from the kit.
      // Apply with Claude (a session that drives Chrome through the employer's site, sign-up and every page) is in the
      // ⋯ menu, for pages the extension can't reach on its own.
      const live = jobsState.claudeReady && resumeOffered() ? sessionFor(job.url) : null;   // a Claude session's Continue / View session: takeover only (claude-help.js)
      if (live) {
        // A session inside the app: Continue when it waits for you, else View session.
        const open = el('button', `row-main ${live.status === 'input' ? 'state-apply' : 'state-opened'}`, live.status === 'input' ? 'Continue' : 'View session');
        open.title = live.note || 'Open this Claude session';
        open.addEventListener('click', () => openSession(live.id));
        box.append(open);
        menu.push({icon: 'puzzle', label: 'Fill in Chrome', run: () => fillInChrome()});
      } else {
        // Filled on the server: the main button opens that filled form (the night's hand-off) to check and submit, not a new fill.
        const fill = Object.assign(el('button', `row-main ${opened && !job.ready ? 'state-opened' : 'state-apply'}`, job.ready ? 'Review & submit' : opened ? 'Opened ↻' : 'Apply'), {
          title: job.ready ? 'The server filled this form overnight: open it in Chrome, check it and press Submit yourself' : opened ? 'Opened in Chrome: click to open it there again' : 'Open in Chrome: the extension fills the form from your kit; you review and submit'});
        fill.addEventListener('click', async () => {
          if (!job.ready) return fillInChrome(fill);
          const result = await window.pilot.readyOpen(job.code).catch(error => ({ok: false, error: error.message}));
          if (result.cancelled) return;
          if (result.ok) { shared.openedInChrome.add(pageKey(job.url)); startedApplying(job); renderJobs(); } else toastMessage('Could not open the filled form', result.error || 'Try again from Actions → Ready to send.');
        });
        box.append(fill);
        if (jobsState.claudeReady && resumeOffered()) {
          const started = claudeStarted.has(pageKey(job.url));
          menu.push({icon: 'bot', label: started ? 'Claude is applying' : 'Apply with Claude', disabled: started,
            title: started ? 'A Claude session is filling this one in its window: answer it there' :
              'For pages the extension can\'t fill alone: Claude opens the posting in Chrome, follows Apply to the employer\'s site, creates an account there ' +
              'if it asks (password saved in your Keychain) and fills every page from your kit. You solve CAPTCHAs, tick the terms and submit.',
            run: async () => {
              const result = await window.pilot.applyWithClaude(job.url, {title: job.title, company: job.company, location: job.location, workMode: job.work_mode});
              if (result.cancelled) return;
              if (result.ok) { claudeStarted.add(pageKey(job.url)); startedApplying(job); if (result.session) await refreshSessions(); renderJobs(); return; }
              // The list said there was a kit but Notion has none (removed or redrafting): Apply drafts it again.
              if (/kit/i.test(result.error || '')) { toastMessage('Kit not found', 'Press Apply to draft it again.'); loadJobs(); } else toastMessage('Claude could not start', result.error || 'Try again.');
            }});
        }
      }
    } else if (job.status !== 'applied' && job.url && job.code) {
      // No kit yet: Apply drafts it first (reads the form's questions, answers each, writes a cover letter), then opens
      // the form in Chrome as it does for a job with a kit. "Prepare only" is in the ⋯ menu.
      const state = prepareState(job);
      const busy = state === 'local' || state === 'cloud';
      const prepare = Object.assign(el('button', busy ? 'row-main state-prepare' : 'row-main state-apply', state === 'failed' ? 'Retry apply' : state === 'cloud' ? 'Preparing…' : state ? 'Preparing' : 'Apply'), {
        title: state === 'cloud' ? 'Preparing on GitHub: the list reloads when it is done' : state === 'local' ? 'Drafting the kit (usually 15–30 s), then the form opens in Chrome'
          : 'Drafts the application kit (form answers and cover letter) first, then opens the form in Chrome; you review and submit'});
      if (busy) { prepare.disabled = true; if (state === 'local') prepare.classList.add('busy', 'state-busy'); }  // spinner only; the fixed width keeps the row still
      prepare.addEventListener('click', async () => {
        preparing.set(job.code, 'local');
        renderJobs();  // the row is rebuilt as Preparing, and stays so through any later re-render
        const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
        // On GitHub (Always on): the row says so; the list reloads when it's done, and the form is not opened for you.
        if (result.cloud) preparing.set(job.code, 'cloud');
        else if (result.ok) { preparing.delete(job.code); for (const item of shared.allJobs) if (item.code === job.code) item.kit = true; job.kit = true; await fillInChrome(); return; }
        else { preparing.set(job.code, 'failed'); sayRefused('Apply did not start', result); }   // a refusal says why (renderer/refusal.js); a draft that failed is notified by main
        renderJobs();
      });
      box.append(prepare);
    }
    // Compact list: save with one click (filled once saved).
    const saved = job.status === 'saved';
    const bookmark = Object.assign(el('button', `secondary icon-btn bookmark${saved ? ' on' : ''}`), {disabled: saved,
      title: saved ? 'Saved' : 'Save: keep this job on your list'});
    bookmark.setAttribute('aria-label', bookmark.title);
    bookmark.append(icon('bookmark'));
    bookmark.addEventListener('click', () => setStatus('saved')());
    if (job.status !== 'applied') box.prepend(bookmark);

    // Long work started from the menu: a note on the row until it's done.
    const background = async (note, work) => {
      if (busyNotes.has(job.url)) return;
      busyNotes.set(job.url, note);
      renderJobs();
      try { await work(); } finally { busyNotes.delete(job.url); renderJobs(); }
    };
    menu.push({icon: 'file', label: 'Open job page', run: () => openJobPanel(job),
      title: 'Its kit, prep, reviews, record, messages, description and history, here beside the list'});
    if (job.notion_url) menu.push({icon: job.kit ? 'file-text' : 'layers', label: job.kit ? 'Open kit in Notion' : 'Open in Notion', run: event => window.pilot.openNotion(job.notion_url, event.metaKey),
      title: job.kit ? 'Application kit: form answers, cover letter, eligibility (in Notion)' : 'This job in your Notion'});   // about Notion
    menu.push({icon: 'external', label: isInbound(job) ? 'Open the message' : 'Open posting', run: () => window.pilot.openExternal(job.url), title: isInbound(job) ? 'The email or chat it came from' : 'The job posting'});
    if (job.kit && job.code) {
      // Draft the kit again from the current Profile and standard answers (replaces it in Notion).
      const earlier = String(job.kit_state || '').startsWith('earlier');
      menu.push({icon: 'refresh', label: earlier ? 'Redraft kit (earlier inputs)' : 'Redraft kit',
        title: `Draft the kit again from your current CV, Profile and standard answers (~20 s); replaces it in ${storeName()}`, run: () =>
        background('↻ Redrafting kit…', async () => {
          const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
          if (result.cloud) openActivity(true); else if (result.ok) loadJobs(); else toastMessage('Redraft failed', result.error || 'Try again.');
        })});
    }
    if (!job.kit && job.code && job.url && job.status !== 'applied' && !prepareState(job)) {
      menu.push({icon: 'layers', wand: true, label: 'Prepare only', title: 'Draft the kit (about 20 s) without opening the form: read it first, then Apply', run: () =>
        background('Preparing kit…', async () => {
          const result = await window.pilot.prepareKit(job.code, `${job.title} · ${job.company}`);
          if (result.cloud) openActivity(true); else if (result.ok) loadJobs(); else toastMessage('Prepare failed', result.error || 'Try again.');
        })});
    }
    if (job.page_id) menu.push({icon: 'chat', label: 'Add employer feedback', run: () => openFeedback({...job, job: job.title}, 'receive')});
    if (job.employer_feedback && job.page_id) menu.push({icon: 'chat', label: 'Read employer feedback', run: () => openFeedback({...job, job: job.title}, 'review')});
    // The saved review is a tag on the row; the menu says it in words too, as the tag alone did not read as clickable.
    if (job.rejection) menu.push({icon: 'file', label: 'View rejection review',
      title: job.rejection_lesson || 'Why it was rejected: evidence and what to improve', run: event => openPage('review', event)});
    if (job.stage === 'Rejected') {
      // Claude reads the posting, what was sent, the timeline and any interview reviews: presentation, hard skills,
      // soft skills, or a different profile (nothing to improve). Written on the job's Notion page.
      menu.push({icon: 'search', label: job.rejection ? 'Review the rejection again' : 'Why was I rejected?',
        title: ai('{AI} reviews this application: presentation, hard skills, soft skills, or not on you (~20 s)'),
        run: () => background('🔎 Reviewing the rejection…', async () => {
          const result = await window.pilot.reviewRejection(job.url);
          toastMessage(result.ok ? 'Rejection reviewed' : 'Review failed', result.text);
          if (result.ok) loadJobs();
        })});
    }
    if (job.code) {
      // A CV tailored to this posting (reworded, reordered bullets from your own CV; the extension uploads it here).
      const tailorNow = () => background('✂️ Tailoring CV…', async () => {
        const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`);
        if (result.ok) job.tailored = true; else toastMessage('Tailoring failed', result.error || 'Try again.');
      });
      menu.push({icon: 'scissors', wand: true, label: job.tailored ? 'Re-tailor CV + cover letter' : 'Tailor CV + cover letter',
        title: 'Make a version of your CV and a cover letter for this job: bullets reordered and reworded toward the posting, only from facts in your CV (about 1–2 min)',
        run: tailorNow});
      // Which terms the posting asks for the CV states, and which requirements could be a yes/no question on the form (a dialog: nothing added to the list).
      menu.push({icon: 'scale', label: 'Check CV match', title: 'Compare your CV with this posting: stated, implied and missing terms, and the requirements that could be knockout questions (about 30 s)',
        run: () => openMatchCheck(job, {tailor: tailorNow})});
    }
    // "How did it go?": one click records what the employer did (in Notion, like a stage the Gmail check finds) and counts it anonymously,
    // by job board and days only, when Technical reports are on. It is how Jobadabra learns which applications get answers.
    const choices = job.url ? outcomeChoices(job.stage, storeName()) : [];
    if (choices.length) {
      menu.push('-');
      if (jobsState.benchmarkText[job.url]) menu.push({icon: 'info', label: jobsState.benchmarkText[job.url], disabled: true, title: 'From how other people\'s applications on this job board went (anonymous counts)'});
      for (const choice of choices) {
        menu.push({icon: choice.icon, label: choice.label, title: choice.title, run: async () => {
          const result = await window.pilot.markOutcome({url: job.url, outcome: choice.outcome, appliedOn: job.applied_on, bucket: scoreBucket(job.fit)}).catch(error => ({ok: false, error: error.message}));
          if (!result.ok) { toastMessage('Not saved', result.error || 'Try again.'); return; }
          jobsChanged(job, choice.outcome !== 'reply' ? {stage: result.stage} : {});   // a reply is an event only: the stage stays where it is
          toastMessage('Saved', `${choice.label.replace(/^(Heard back|No answer): /, '')} — recorded in ${storeName()}.`);
          renderJobs();
        }});
      }
    }
    // Actions read as verbs (the Status column shows where a job stands).
    menu.push('-');
    if (job.status !== 'saved') menu.push({icon: 'bookmark', label: 'Save', run: setStatus('saved'), title: 'Keep this job on your list'});
    if (job.stage === 'Applying') {  // the session is over or was closed: say what happened, instead of staying Applying
      menu.push({icon: 'tick', label: 'I submitted it', run: setStatus('applied'), title: `Mark it Applied in ${storeName()}`});
      menu.push({icon: 'undo', label: 'Not submitted', title: 'Back to Kit ready', run: async () => {
        const result = await window.pilot.unapplyJob(job.url).catch(error => ({ok: false, error: error.message}));
        if (!result.ok) { toastMessage('Status not changed', result.error || 'Something went wrong.'); return; }
        jobsChanged(job, {stage: 'Kit ready'});
        renderJobs();
      }});
    } else if (job.status !== 'applied') menu.push({icon: 'tick', label: 'Mark applied', run: setStatus('applied'), title: 'You applied to this job: track it in Applications'});
    if (job.stage === 'Applied') menu.push({icon: 'undo', label: "This wasn't submitted…", title: 'Back to Applying, and the Applied record removed',
      run: async () => {
        // Only a bare Applied: a stage past it (a confirmation, an interview) is the employer's own evidence.
        if (!confirm(`Mark this as not submitted? It goes back to Applying and the Applied date and event are removed from ${storeName()}.\n\n`
          + 'Use this when Jobadabra marked it Applied by itself and no application was sent.')) return;
        const result = await window.pilot.notSubmitted(job.url).catch(error => ({ok: false, error: error.message}));
        if (!result.ok) { toastMessage('Not changed', result.error || 'Something went wrong.'); return; }
        jobsChanged(job, {stage: 'Applying', status: 'applied'});
        toastMessage('Back to Applying', `The Applied record was removed${result.events ? ` (${result.events} ${byStore('Notion ', '')}event${result.events === 1 ? '' : 's'})` : ''}.`);
        renderJobs();
      }});
    if (reopenable(job.stage)) menu.push({icon: 'undo', label: 'Reopen', run: setStatus('applied'), title: `Back to Applied: waiting for a reply again (recorded in ${storeName()})`});
    if (job.status !== 'dismissed') menu.push({icon: 'close', label: 'Dismiss', run: setStatus('dismissed'), title: 'Not interested: hide this job', danger: true});
    // A dismissed job can go for good (owner, 7 Oct 2026): its Notion pages to the trash (30 days there), and no search brings it back.
    else menu.push({icon: 'trash', label: 'Delete', danger: true, title: byStore('Remove this job: its Notion pages go to the trash, and searches will not show it again', 'Remove this job for good: searches will not show it again'),
      run: async () => {
        if (!confirm(`Delete "${job.title}" at ${job.company}?\n\n${byStore('Its Notion pages go to Notion\'s trash (restorable there for 30 days), and searches will not show it again.', 'It is removed from Jobadabra, and searches will not show it again.')}`)) return;
        const result = await window.pilot.deleteJob(job.url).catch(error => ({ok: false, error: error.message}));
        if (!result?.ok) { toastMessage('Not deleted', result?.error || 'Something went wrong.'); return; }
        const left = shared.allJobs.filter(other => other !== job);
        shared.allJobs = left;
        // The header and counters are counted from loaded data (showJobsData): counted again now, one job fewer.
        if (jobsState.lastJobsData) showJobsData({...jobsState.lastJobsData, jobs: left, total: jobsState.lastJobsData.total == null ? jobsState.lastJobsData.total : jobsState.lastJobsData.total - 1});
        toastMessage('Deleted', result.trashed ? byStore('Its Notion pages are in the trash.', 'It is deleted.') : 'It will not come back.');
        renderJobs();
      }});
    box.append(moreButton(menu, 'More: save, dismiss, kit, posting, tailor CV'));

    row.append(fit, role, company, place, status, box);
    // The job's drawer (pages/job-panel.js): a click anywhere on the row outside its controls and its analysis (the score ring opens that, when there is one).
    if (panelUrl() && panelUrl() === job.url) row.classList.add('is-selected');
    row.addEventListener('click', event => {
      if (!isInteractiveTarget(event.target, row) && !(canOpen && fit.contains(event.target)) && !event.target.closest('.fit-detail, .ui-menu')) openJobPanel(job);   // the score cell opens the drawer too, unless it opens its own analysis
    });
    // The score ring opens why: Match analysis (the score's parts, strengths and gaps; Notion Job Matches keeps
    // them). The caret turns with it, and the row's own one-line summary steps aside for the panel's lead.
    if (canOpen) {
      const close = () => {
        row.querySelector('.fit-detail')?.remove();
        fit.classList.remove('is-open');
        fit.title = 'Why this score? Click to see';
      };
      fit.classList.add('is-clickable');
      fit.addEventListener('click', () => {
        if (row.querySelector('.fit-detail')) { close(); return; }
        fit.classList.add('is-open');
        fit.title = 'Hide the match analysis';
        row.append(fitDetail(job, close, () => openJobPanel(job, 'match')));
      });
    }
    body.append(row);
  }
  // What the list is filtered to, said once: a chip (✕ shows every job) and "4 of 195 jobs".
  const statLabel = jobsState.statFilter?.label || {applied: 'Applied', waiting: 'Waiting for a reply', interviews: 'In process', closed: 'Closed',
    stuck: 'Still marked Applying', high: 'High fit (70+)', companies: 'One per company'}[jobsState.statFilter];
  renderStuck();
  const plural = count => `${count} job${count === 1 ? '' : 's'}`;
  // The engine sends the best rows only (src/desktop.py jobs): say how many are left out and offer them, never a silent cut (7 Oct 2026: 200 of 1,335).
  const notLoaded = Math.max(0, (jobsState.lastJobsData?.total ?? 0) - shared.allJobs.length);
  $('jobs-count').textContent = (statLabel ? `${rows.length} of ${plural(shared.allJobs.length)}` : plural(rows.length)) +
    (notLoaded ? ` · ${notLoaded} more with lower fit` : '');
  show($('jobs-more'), notLoaded > 0);
  $('jobs-more').textContent = `Show ${Math.min(notLoaded, MORE)} more`;
  show($('jobs-filter'), !!statLabel);
  $('jobs-filter-text').textContent = statLabel ? `Showing: ${statLabel}` : '';
  show($('jobs-filter-back'), jobsState.statFilter?.from === 'focus');
  // A filter from another page (a Focus funnel step) is none of the boxes: they're greyed out until it's cleared.
  document.querySelectorAll('.stat-cards').forEach(cards => cards.classList.toggle('is-dimmed', !!jobsState.statFilter?.urls));
  document.querySelectorAll('[data-stat]').forEach(card => card.setAttribute('aria-pressed', String(statPressed(card.dataset.stat, jobsState.statFilter, filter))));
  if (jobsState.jobsLoading && !shared.allJobs.length) { show($('jobs-empty'), false); showLoading(); return; }  // still loading, not empty
  show($('jobs-empty'), rows.length === 0 && !document.body.dataset.findCard?.match(/^(empty|searching|failed)$/));   // the Find jobs card on top says it
  const emptyFor = {saved: 'No saved jobs yet. On any job, <b>⋯ → Save</b> keeps it here for later.',
    applied: 'No applications yet. Apply from a job, or add one you sent elsewhere with <b>+ Add</b>',
    dismissed: 'No dismissed jobs.', inbound: 'Nothing found you yet. A recruiter\'s message you log (<b>+ Add</b> → message or update) shows here.'};
  $('jobs-empty').innerHTML = !shared.allJobs.length ? ($('refresh').disabled ? 'Searching now: the jobs appear here as they are found.'
      : 'No jobs here yet. Click <button type="button" class="link" data-refresh-jobs><b>Find jobs</b></button>.')
    : anyStatus ? 'That job isn\'t in your list: not found by a search yet, or hidden by your language or company filters.'
    : !text && !jobsState.statFilter && emptyFor[filter] ? emptyFor[filter]
    : text || jobsState.statFilter || filter !== 'all' ? 'No job matches this filter.' : 'No open jobs right now.';
  // The board shows applications only (rows with a Stage); the stage filters ticked, a counter and the words narrow it.
  const onBoard = boardIds(filters);   // the ticked filters that name a stage; none: every application
  paintViews((counted || shared.allJobs).filter(job => columnOf(job) && (counted || !onBoard.length || inFilters(job, onBoard, now)) && matches(job, text)));   // a job the board has a column for (jobs-board-rules.js)
}

// "Refresh jobs" in the empty list is the same trigger as the header button (a disabled one, while a refresh runs, ignores it).
document.addEventListener('click', event => { if (event.target.closest?.('[data-refresh-jobs]')) $('refresh')?.click(); });

// While the list loads from Notion (a few seconds): a spinner in the empty list the first time; afterwards the
// list stays and the subtitle says it's refreshing.
export function showLoading() {
  if (shared.allJobs.length) { $('jobs-stats').textContent = byStore('Refreshing from Notion…', 'Refreshing…'); return; }
  const box = el('div', 'list-loading');
  box.append(el('span', 'spinner'), el('div', '', byStore('Loading your jobs from Notion…', 'Loading your jobs…')),
    el('div', 'muted small', 'Job Matches and Applications, usually a few seconds'));
  $('jobs-body').replaceChildren(box);
  $('jobs-stats').textContent = byStore('Loading from Notion…', 'Loading…');
}

const INPUT_NAMES = {cv: 'CV', profile: 'Profile', answers: 'standard answers'};
function kitLabel(state = '') {
  if (state === 'current') return {label: '📝 Kit', title: 'Current: drafted from your current CV, Profile and standard answers.'};
  if (state.startsWith('earlier')) {
    const changed = state.split(':')[1]?.split(',').map(name => INPUT_NAMES[name] || name).join(', ') || 'inputs';
    return {label: '📝 Kit · earlier inputs', title: `Drafted with earlier inputs: your ${changed} changed since. Redraft it from the ⋯ menu if you still want it.`};
  }
  return {label: '📝 Kit', title: 'Inputs unknown: drafted before Jobadabra recorded which CV, Profile and answers a kit came from.'};
}
