// Recent activity: the Gmail check card: its rows, questions, folds and interview panels.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {ai} from '../ai-name.js';
import {emailNoun, questionWhy} from '../question-words.js';
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {mailChanges, mailCounts, mailNoCards, mailResults} from '../mail-report.js';
import {shared} from './shared.js';
import {$} from './core.js';
import {prepAction} from './focus.js';
import {openView} from './nav.js';
import {openJobPanel} from './job-panel.js';
import {whichJob} from './reassign.js';
import {openPrep, prepRunning} from './prep.js';
// A Gmail check's own lines about the emails: the update it recorded — with what moved on the job — and every email
// it read, each opening in Gmail. Its own rows, so a check that sent nothing to Telegram still accounted for itself.
function mailDiff(changes) {
  const row = el('div', 'mail-diff');
  for (const part of mailChanges(changes)) {
    // "Stage Applied → Confirmation received" reads as a label and its movement; "Confirmation email set" is one flag.
    // el() takes one node or text, never an array of both (that renders "[object HTMLElement]"): append them here.
    // "Stage Applied → Screening" reads as a field and its move: [Stage | Applied → Screening] (owner's mockup, 6 Oct 2026).
    const pill = el('span', part.flag ? 'mail-diff-flag' : 'mail-diff-move');
    const field = !part.flag && /^(Stage|Next interview|Feedback status|Confirmation email)\s+(.+)$/.exec(part.from);
    if (part.flag) pill.textContent = part.flag;
    else if (field) pill.append(el('span', 'mail-diff-field', field[1]), el('span', '', `${field[2]} → ${part.to}`));
    else pill.append(el('b', '', part.from), ` → ${part.to}`);
    row.append(pill);
  }
  return row;
}
// A Gmail check's card (the owner's mockup, 6 Oct 2026): a strip of counts with icons, then one card per email, every card
// built from the same parts in the same order, whatever happened —
//   ① the company, the role, sender · date, and ONE outcome pill top right (Rejected, Interview scheduled, Reply received,
//      Needs your answer, Answered, No change…);
//   ② the engine's own sentence ("Application rejected after consideration.");
//   ③ the move it made: [Stage | Confirmation received → Rejected], only when something moved;
//   ④ at most one panel, by outcome: the AI's reading of a rejection, the interview (when and where, what to prepare, the
//      recruiter's next step, consent), or the which-job question / your answer;
//   ⑤ "Email details", folded: the subject.
// An update no email claims (a calendar event, a run kept on this Mac) and a day-before interview reminder are cards of the
// same shape. With no relevant email one line says nothing changed; with no new email the strip alone says it.
const OUTCOME = {Rejected: ['Rejected', 'bad'], Interview: ['Interview scheduled', 'good'], 'Interview scheduled': ['Interview scheduled', 'good'],
  Offer: ['Offer', 'good'], 'Reply received': ['Reply received', 'info'], 'Application received': ['Application received', 'info'],
  Applied: ['Applied', 'info'], 'You replied': ['You replied', 'neutral']};
const outcomePill = kind => { const [text, tone] = OUTCOME[kind] || [kind, 'info']; return pill(text, tone); };
const sentence = text => (text && !/[.!?]$/.test(text) ? `${text}.` : text || '');
const changeOf = text => (/→/.test(text || '') ? text : '');   // "nothing to record (Rejected)" is not a change
const VERDICT_TITLE = {'Hard skills': 'Possible skills gap', 'Soft skills': 'Possible soft-skills gap',
  Presentation: 'Possible gap: how the application read', Unclear: 'Reason unclear'};
const openFolds = new Set();   // which folds are open, kept across the card's redraws (it is drawn again on every refresh)
const jobKey = text => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

// One fold, the same everywhere: a chevron and a label, its content hidden until opened.
function fold(key, label, content, className = 'mail-fold') {
  const box = el('div', className);
  const toggle = el('button', 'mail-fold-toggle');
  toggle.type = 'button';
  const show = () => {
    const open = openFolds.has(key);
    toggle.replaceChildren(icon('chevron'), label);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    content.hidden = !open;
  };
  toggle.addEventListener('click', () => { if (openFolds.has(key)) openFolds.delete(key); else openFolds.add(key); show(); });
  show();
  box.append(toggle, content);
  return box;
}

function mailCardRow({company, role = '', lines = [], tag = null, summary = '', changes = '', panel = null, details = '', noDetails = ''}) {
  const card = el('li', 'mail-email');
  const head = el('div', 'mail-email-head');
  const words = el('div', 'mail-email-words');
  words.append(el('h3', '', company || 'Email'));
  if (role) words.append(el('p', 'mail-email-role', role));
  lines.filter(Boolean).forEach(line => words.append(el('p', 'mail-email-meta', line)));
  head.append(words);
  if (tag) head.append(tag);
  card.append(head);
  if (summary) card.append(el('p', 'mail-email-summary', sentence(summary)));
  if (changes) card.append(mailDiff(changes));
  if (panel) card.append(panel);
  // "Email details" closes every card, the same everywhere; a card the run kept without its email (an update from this Mac's
  // log, a calendar event, a reminder) says so instead of leaving the fold out.
  card.append(fold(`details:${subjectKey(details || company)}:${subjectKey(role)}`, 'Email details',
    el('p', 'mail-fold-text', details ? `Subject: ${details}` : noDetails || 'This run kept no email for it.'), 'mail-fold mail-email-details'));
  return card;
}

// -> the number of questions still waiting for you (the strip says it).
function mailSections(box, report, pending = [], answered = null) {
  const {results, updates} = mailResults(report);
  const found = report.status.emails ?? report.emails.length;
  const meeting = report.interview;
  let meetingShown = false, waiting = 0;
  const meetingPanel = () => { meetingShown = true; return interviewPanel(report); };
  const aboutMeeting = job => !!meeting && jobKey(job).includes(jobKey(meeting.company)) && jobKey(job).includes(jobKey(meeting.title).slice(0, 24));
  const cards = [];
  for (const update of updates) {
    const made = updateCard(update, pending, answered, aboutMeeting(update.job) && !meetingShown ? meetingPanel : null);
    waiting += made.waiting;
    cards.push(made.card);
  }
  for (const result of results) {
    const made = emailCard(result, pending, answered, result.covered && !meetingShown ? meetingPanel : null);
    waiting += made.waiting;
    cards.push(made.card);
  }
  if (meeting && !meetingShown) {   // the day-before reminder: the interview was recorded by an earlier check
    cards.push(mailCardRow({company: meeting.company, role: meeting.title, lines: ['Already on record'], tag: pill('Reminder', 'neutral'), panel: meetingPanel(),
      noDetails: 'A reminder from your calendar: no new email. The interview was recorded by an earlier check.'}));
  }
  if (!cards.length && !(found > 0)) return 0;
  if (!cards.length) { box.append(el('p', 'muted mail-nochange', mailNoCards(report))); return 0; }
  const list = el('ol', 'mail-emails');
  list.append(...cards);
  box.append(list);
  return waiting;
}

function emailCard(result, pending, answered, meetingPanel) {
  const {email, outcome, assessment: review, update} = result;
  const asked = email && NEEDS_YOU.has(email.action) ? questionState(email, pending, answered) : null;
  const kind = outcome?.kind || (update && !update.question ? update.summary : '');
  const tag = asked ? (asked.answered ? pill('Answered', 'good') : pill('Needs your answer', 'warn'))
    : kind ? outcomePill(kind) : meetingPanel ? outcomePill('Interview scheduled')
    : email?.action === 'recorded' ? pill('Updated', 'good') : pill('No change', 'neutral');
  // The engine's sentence, unless the interview panel says the same (its date, event and source).
  const said = meetingPanel ? '' : outcome ? [outcome.summary, ...outcome.details.filter(line => !/^Source:/i.test(line))].filter(Boolean).join(' · ')
    : update?.when || '';
  const noun = emailNoun(email);
  // "Which job?" is not a kind of email: it is the job missing from an email that is an interview, a rejection, a reply…
  // Placed on a job, it is that kind's card for that job, with your answer one line under it (owner, 6 Oct 2026).
  const asking = asked ? questionKind(result, asked, noun) : '';
  if (asked?.answered && asked.job) return {card: placedCard(result, asked, asking), waiting: 0};
  // An interview this check recorded with no reminder message (a run on this Mac): the same panel, from what it knows.
  const interviewHere = !meetingPanel && !asked && /^Interview/.test(kind)
    ? () => interviewPanel({interview: {when: update?.when || (outcome?.summary || '').replace(/\s*·\s*/, ' '), company: result.company, title: result.role,
      where: (outcome?.details || []).map(line => /^Event:\s*(.+)$/i.exec(line)?.[1]).find(Boolean) || '', summary: '', people: []}, topics: [], nextSteps: [], consent: '', url: ''}) : null;
  const card = mailCardRow({
    company: result.company || email?.subject, role: asked && !asked.answered ? `${KIND_NOUN[asking] || 'Email'} · Role unidentified` : result.role,
    lines: [[email?.sender, email?.time].filter(Boolean).join(' · ')],
    tag, summary: interviewHere ? '' : said, changes: update && !update.question ? update.changes : changeOf(email?.changes),
    panel: review ? assessmentPanel(review) : meetingPanel ? meetingPanel() : interviewHere ? interviewHere()
      : asked ? questionPanel(asked, subjectKey(email.subject), email.subject, {noun, company: result.company}) : null,
    details: email?.subject && result.company ? email.subject : '', noDetails: email?.subject ? 'The subject is the title above.' : ''});
  return {card, waiting: asked && !asked.answered ? 1 : 0};
}
// What the email itself is, while its job is the question: the engine's question line says it ("<mark> Interview · Blockdaemon —
// which job?"), Focus's question too (event_kind); an invitation without either is an interview.
const KIND_NOUN = {Interview: 'Interview invitation', 'Interview scheduled': 'Interview invitation', Rejected: 'Rejection',
  'Reply received': 'Reply', 'Application received': 'Application confirmation', Offer: 'Offer'};
function questionKind(result, asked, noun) {
  const said = result.update?.question ? result.update.summary : asked.open?.event_kind || '';
  return said || (noun === 'invitation' ? 'Interview' : '');
}
// "Invitation …: Igor Mardari and Blockdaemon DM @ Fri 2 Oct 2026 21:30–22:15 (CEST)" -> "Fri 2 Oct 2026 21:30".
const whenOf = subject => { const m = /@\s*((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+\d{1,2}\s+\w+(?:\s+\d{4})?)\s+(\d{1,2}:\d{2})/.exec(subject || ''); return m ? `${m[1]} ${m[2]}` : ''; };
// The card of what the email is (interview, rejection, reply…), for the job you placed it on. Its stage move and a
// rejection's AI reading come with the engine's next record for that job: here, only what this email and your answer say.
function placedCard(result, asked, kind) {
  const {email} = result;
  const [company, ...title] = asked.job.split(/\s+—\s+/);
  const created = isNewJob(asked.job);
  const interview = /^Interview/.test(kind);
  const note = el('div', 'mail-mapped');
  const line = resolution(asked, result.company || company);
  const why = `The ${interview ? 'invitation' : 'email'} names ${result.company || 'the sender'} but doesn't specify the role.`;
  note.append(line, fold(`asked:${subjectKey(email.subject)}`, 'Original question', el('p', 'mail-fold-text', `${QUESTION} ${why}`)));
  let panel = note;
  if (interview) {
    panel = el('div', 'mail-placed');
    const meeting = {when: whenOf(email.subject), company, title: title.join(' — '), summary: '', where: '', people: []};
    panel.append(interviewPanel({interview: meeting, topics: [], nextSteps: [], consent: '', url: ''}), note);
  }
  return mailCardRow({company, role: created ? 'New job · role to add in Focus' : title.join(' — '), lines: [[email.sender, email.time].filter(Boolean).join(' · ')],
    tag: kind ? outcomePill(interview ? 'Interview scheduled' : kind) : pill('Answered', 'good'), panel, details: email.subject});
}
// An update no email claims: its job, what it moved, or the which-job question it raised.
function updateCard(update, pending, answered, meetingPanel) {
  const [company, ...role] = String(update.job).split(/\s+—\s+/);
  if (update.question) {
    const open = pending.find(item => item.company && jobKey(update.job).includes(jobKey(item.company)));
    const here = open ? answeredHere.get(subjectKey(open.subject)) : undefined;
    const state = here !== undefined ? {answered: true, job: here} : open ? {open} : answered ? {answered: true, job: '', unknown: true} : {};
    if (state.answered && state.job && open) {   // placed: the card of what it is, for that job, as for an email
      return {card: placedCard({email: {subject: open.subject, sender: '', time: ''}, company: open.company}, state, update.summary), waiting: 0};
    }
    const card = mailCardRow({company: open?.company || company, role: `${KIND_NOUN[update.summary] || 'Email'} · Role unidentified`, tag: state.answered ? pill('Answered', 'good') : pill('Needs your answer', 'warn'),
      panel: questionPanel(state, subjectKey(update.job), open?.subject || '', {noun: 'email', company: ''}), details: open?.subject || ''});
    return {card, waiting: state.answered ? 0 : 1};
  }
  return {card: mailCardRow({company, role: role.join(' — '), lines: [update.source || ''], tag: outcomePill(update.summary),
    summary: meetingPanel || /^Interview/.test(update.summary) ? '' : update.when || '', changes: update.changes,
    panel: meetingPanel ? meetingPanel() : /^Interview/.test(update.summary)
      ? interviewPanel({interview: {when: update.when || '', company, title: role.join(' — '), where: '', summary: '', people: []}, topics: [], nextSteps: [], consent: '', url: ''}) : null,
    noDetails: 'This run recorded the update without listing its email (a run on this Mac, or a calendar event).'}), waiting: 0};
}

// The AI's reading of a rejection: its verdict and one line on what the role wanted, marked as a guess; the role-vs-you
// comparison folds open under "AI assessment".
function assessmentPanel(review) {
  const panel = el('aside', 'mail-ai');
  const words = el('div', 'mail-ai-words');
  const top = el('div', 'mail-ai-top');
  // The AI's own rating of how sure it is that this is the reason (src/ai/rejection.py: "low" when the evidence is thin).
  top.append(el('b', '', VERDICT_TITLE[review.verdict] || review.verdict), pill(`${review.confidence.replace(/^./, c => c.toUpperCase())} confidence`, 'warn',
    {title: 'How sure the AI is that this is the reason, from what Jobadabra kept: the posting, your profile and the emails. Low means little evidence.'}));
  words.append(top, el('p', '', review.focus || review.summary));
  // "AI assessment ⌄" (the mockup's label) opens the comparison under the verdict: what the role wanted, what you bring.
  const key = `ai:${jobKey(review.job)}`;
  const label = el('button', 'mail-ai-label');
  label.type = 'button';
  const facts = el('dl', 'mail-assessment-facts');
  facts.append(el('dt', '', 'Role focus'), el('dd', '', review.focus || review.summary), el('dt', '', 'Your background'), el('dd', '', review.background || '—'));
  const show = () => {
    const open = openFolds.has(key);
    label.replaceChildren(icon('sparkle'), el('b', '', 'AI assessment'), icon('chevron', 'icon mail-ai-chevron'));
    label.classList.toggle('is-open', open);
    label.setAttribute('aria-expanded', String(open));
    facts.hidden = !open;
  };
  label.addEventListener('click', () => { if (openFolds.has(key)) openFolds.delete(key); else openFolds.add(key); show(); });
  show();
  words.append(facts, el('p', 'mail-ai-note', 'AI interpretation; the employer did not confirm this reason.'));
  panel.append(label, words);
  return panel;
}
// The interview: when, where and who in a calendar box; what to prepare and the recruiter's next step side by side; consent.
function interviewPanel(report) {
  const {interview} = report;
  const box = el('div', 'mail-meeting');
  const when = el('div', 'mail-meeting-when');
  const tile = el('span', 'mail-meeting-tile');
  tile.append(icon('calendar'));
  const words = el('div', 'mail-meeting-words');
  words.append(el('b', '', interview.when ? interview.when.replace(/\s+(\d{1,2}:\d{2})$/, ' · $1') : [interview.title, interview.company].filter(Boolean).join(' · ')));
  const line = [interview.where, interview.summary].filter(Boolean).join(' · ');
  if (line) words.append(el('p', '', line));
  if (interview.people.length) words.append(el('p', '', `Participants: ${interview.people.join(' · ')}`));
  when.append(tile, words);
  // The call to action: the interview's prep kit, built or opened from here as Focus does (focus.js prepAction).
  const side = el('div', 'mail-meeting-side');
  const prep = prepAction(interview.company) || jobPrep(interview.company, interview.title);
  const go = el('button', prep?.busy ? 'secondary' : 'primary', prep ? prep.label : 'Build prep kit');
  go.type = 'button';
  if (prep?.busy) go.prepend(el('span', 'spinner small'));
  go.title = prep ? prep.title || '' : 'Place this interview on a job first: the kit is built on the job\'s page.';
  go.disabled = !prep || !!prep.busy;
  go.addEventListener('click', event => prep?.run(event));
  side.append(go);
  if (report.url) {
    const view = Object.assign(el('a', 'link', 'Application in Notion ↗'), {href: '#'});
    view.dataset.link = report.url;
    side.append(view);
  }
  when.append(side);
  box.append(when);
  if (report.topics.length || report.nextSteps.length) {
    const columns = el('div', 'mail-meeting-columns');
    if (report.topics.length) {
      const left = el('section', '');
      left.append(el('h4', '', 'Prepare for the conversation'));
      const list = el('ul', 'mail-topics');
      report.topics.forEach(topic => list.append(el('li', '', topic)));
      left.append(list);
      columns.append(left);
    }
    if (report.nextSteps.length) {
      const right = el('section', '');
      const heading = el('div', 'mail-block-head');
      heading.append(el('h4', '', 'Recruiter follow-up'), pill('Pending with recruiter', 'neutral'));
      right.append(heading, ...report.nextSteps.map(text => el('p', '', text)));
      columns.append(right);
    }
    box.append(columns);
  }
  if (report.consent) {
    const consent = el('p', 'mail-meeting-consent');
    consent.append(icon('mic'), report.consent);
    box.append(consent);
  }
  return box;
}

// The prep kit for a job Focus holds no item for yet (an interview you have just placed on it): built on the job's own
// page, as Focus builds it; "Building…" with a spinner until it settles, then "Open prep kit".
export const kitBuilding = new Set(), kitReady = new Set();
function jobPrep(company, title) {
  const found = (shared.allJobs || []).find(one => jobKey(one.company || one.via) === jobKey(company) && jobKey(one.title).startsWith(jobKey(title).slice(0, 40)));
  if (!found?.page_id) return null;
  const id = found.page_id;
  if (kitBuilding.has(id)) return {label: 'Building…', busy: true, run: () => {}};
  // A ready kit opens where it is: its Notion page, else the job's page here on its Prep tab (never offered as a new build, $0.04).
  if (kitReady.has(id)) return {label: 'Open prep kit', run: event => (found.notion_url ? window.pilot.openNotion(found.notion_url, event?.metaKey) : (openView('jobs'), openJobPanel(found, 'prep')))};
  return {label: 'Build prep kit', title: ai('{AI:main} builds it from the job, your Profile and your earlier interviews'), run: () => {
    openPrep({page_id: id, company: found.company || found.via, job: found.title, notion_url: found.notion_url, url: found.url, badge: ''});
    kitBuilding.add(id);
    document.dispatchEvent(new Event('focus-rendered'));
    prepRunning(id)?.then(result => {
      kitBuilding.delete(id);
      if (result?.ok) kitReady.add(id);
      document.dispatchEvent(new Event('focus-rendered'));
    });
  }};
}
// The which-job question on its email's card. Open: the reason and "Choose the job", which opens the popup Focus uses
// (reassign.js); answered: the job you picked, the original question folded under it.
const subjectKey = text => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
const NEEDS_YOU = new Set(['needs you', 'asked']);
// Answers saved from this card, by subject: the card turns to "Answered" at once, before Focus is read again from Notion.
const answeredHere = new Map();
function questionState(email, pending, answered) {
  const key = subjectKey(email.subject);
  const here = answeredHere.get(key);
  if (here !== undefined) return {answered: true, job: here, role: here.split(/\s+—\s+/).slice(1).join(' — ') || here};
  const open = key && pending.find(item => subjectKey(item.subject) === key);
  if (open) return {open};
  const done = key && (answered || []).find(item => subjectKey(item.subject) === key);
  if (done) return {answered: true, job: done.job, role: done.job.split(/\s+—\s+/).slice(1).join(' — ') || done.job};
  return answered ? {answered: true, job: '', unknown: true} : {};   // Focus read, no record of it: answered before the app kept the job
}
const QUESTION = 'Which job is this email about?';
// The job you chose, in full ("Alpenglow Logistics — Platform Engineer"), opening its Notion page, or its posting without one.
function jobLink(job, tagName = 'p') {
  const [company, ...title] = job.split(/\s+—\s+/);
  const found = (shared.allJobs || []).find(one => jobKey(one.company || one.via) === jobKey(company) && jobKey(one.title).startsWith(jobKey(title.join(' — ')).slice(0, 40)));
  if (!found || (!found.notion_url && !found.url)) return el(tagName, 'mail-ask-answer', job);
  const link = Object.assign(el('a', 'link mail-ask-answer', `${job} ↗`), {href: '#'});
  link.title = found.notion_url ? 'Open the job in Notion' : found.page_id ? 'Open the job\'s page' : 'Open the posting';
  link.addEventListener('click', event => { event.preventDefault(); if (found.notion_url) window.pilot.openNotion(found.notion_url, event.metaKey); else if (found.page_id) { openView('jobs'); openJobPanel(found); } else window.pilot.openExternal(found.url); });
  return link;
}
function questionPanel(state, key, subject = '', {noun = 'email', company = ''} = {}) {
  const why = questionWhy(noun, company);
  const panel = el('div', state.answered ? 'mail-ask is-answered' : 'mail-ask');
  const mark = el('span', 'mail-ask-icon');
  mark.append(icon(state.answered ? 'check-circle' : 'help'));
  const words = el('div', 'mail-ask-words');
  if (!state.answered) {
    words.append(el('b', '', state.open?.title || QUESTION), el('p', '', why));
    const go = el('button', 'primary mail-question-go', state.open ? 'Choose the job ' : 'Answer in Focus ');
    go.type = 'button';
    go.append(icon(state.open ? 'chevron' : 'external'));
    go.addEventListener('click', () => {
      if (!state.open) { openView('focus'); return; }
      whichJob(state.open, job => {
        answeredHere.set(subjectKey(subject || state.open.subject), job);
        document.dispatchEvent(new Event('focus-rendered'));   // draw the card again: it reads "Answered"
      });
    });
    panel.append(mark, words, go);
    return panel;
  }
  // Answered: the same compact resolution row as an email placed on a job, and the question folded under it.
  const note = el('div', 'mail-mapped');
  note.append(resolution(state, company), fold(`asked:${key}`, 'Original question', el('p', 'mail-fold-text', `${QUESTION} ${why}`)));
  return note;
}
// What your answer did, one line for every answer (owner, 6 Oct 2026): linked to a job, created one, not about a job, or an answer
// given before the app kept which job it went to (said as such, not guessed).
const isNewJob = job => /\s—\s*new job$/i.test(job || '');
function resolution(state, company = '') {
  const line = el('p', 'mail-mapped-line');
  line.append(icon('check-circle'));
  if (state.unknown) line.append('Answered earlier', el('span', 'muted', 'which job it went to was not recorded'));
  else if (!state.job) line.append('Marked as not job-related');
  else if (isNewJob(state.job)) line.append(`Created a job for ${company || state.job.split(/\s+—\s+/)[0]} and linked this email`, el('span', 'muted', 'Add its role in Focus'));
  else line.append('Linked to ', jobLink(state.job, 'span'));
  return line;
}
export function renderMailCard(report, pending = [], answered = null, target = $('activity-card')) {
  const box = el('div', 'run-card-body mail-card');
  const waiting = mailSections(box, report, pending, answered);
  // The notes the message carries that are none of the above (instructions to you).
  const notes = report.notes.filter(note => !note.fromRow);
  if (notes.length) {
    const list = el('ul', 'mail-notes');
    notes.forEach(note => {
      const item = el('li', '');
      if (note.icon) item.append(el('span', 'mail-note-icon', note.icon));
      item.append(el('span', '', note.text));
      list.append(item);
    });
    box.append(list);
  }
  // The strip: each count with its icon, counted from the cards (mail-report.js), and the questions still waiting for you.
  const status = el('div', 'mail-strip');
  const ICONS = [[/new email|reviewed/, 'mail', ''], [/relevant/, 'file', ''], [/update/, 'check-circle', 'is-good']];
  const stat = (value, label, glyph, tone = '') => {
    const cell = el('span', `mail-strip-stat ${tone}`.trim());
    const words = el('span', '');
    words.append(el('b', '', String(value)), ` ${label}`);
    cell.append(icon(glyph), words);
    return cell;
  };
  const counts = mailCounts(report);
  counts.forEach(({value, label}) => { const [, glyph, tone] = ICONS.find(([pattern]) => pattern.test(label)) || [null, 'mail', '']; status.append(stat(value, label, glyph, tone)); });
  if (waiting) status.append(stat(waiting, waiting === 1 ? 'needs your answer' : 'need your answer', 'bang-circle', 'is-warn'));
  if (!counts.length) {   // no new email: the strip alone says so
    const cell = el('span', 'mail-strip-stat is-good');
    cell.append(icon('check-circle'), report.status.sentence || report.status.title);
    status.append(cell);
  }
  // In the run panel the card's top says the counts (run-result-card.js): the strip is not drawn twice, and a check with nothing else has no bottom.
  // A count of 0 is not said ("0 updates recorded"); a check that changed nothing says so once, under the top's title.
  const title = [...counts.filter(({value}) => Number(value) !== 0).map(({value, label}) => `${value} ${label}`),
    waiting && `${waiting} ${waiting === 1 ? 'needs your answer' : 'need your answer'}`].filter(Boolean).join(' · ') || report.status.sentence || report.status.title || '';
  if (target.id === 'activity-card') {
    const only = box.childElementCount === 1 && box.firstElementChild.classList.contains('mail-nochange') ? box.firstElementChild.textContent : '';
    if (!box.childElementCount || only) { target.replaceChildren(); return {empty: true, title, summary: only, asks: waiting}; }
  } else box.prepend(status);
  target.replaceChildren(box);
  return {empty: false, title, asks: waiting};
}

