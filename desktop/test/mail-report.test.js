// The four shapes a Gmail check's stored message really has (read from Notion, 30 Sep 2026), and the row's result line.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const {mailChanges, mailResults, mailStatus, mailNoCards, mailCardShown, parseMailReport, settleQuestion} = await import('../renderer/mail-report.js');

const PREP = [
  '🗓 Tomorrow 08:30 — Huxley — Principal SRE',
  'Follow up Igor / Jaya - SRE',
  'Microsoft Teams Meeting',
  'With: Seosahai - Nejati, Jayantie',
  '🏋️ Answered weakly in past interviews',
  '• Tenure / commitment',
  '• Customer bridge calls',
  '• Non-public-cloud infrastructure and security',
  '📝 Recruiter to follow up on nationality/location constraints and salary expectations, with a further call planned to discuss compensation and contractual setup (B2B vs employee).',
  'Recording? Ask everyone for consent at the start.',
  'Application in Notion (https://app.notion.com/p/Principal-SRE-via-Huxley-3ea62be8fd8681299dd8cc115550b8da)',
].join('\n');

test('a Gmail check tells what it did, in the row\'s own numbers', () => {
  assert.deepEqual(mailStatus('Gmail check: 1 new email(s) read, 0 update(s) recorded'),
    {title: 'Check complete', sentence: '1 email reviewed. No application records changed.', emails: 1, updates: 0});
  assert.deepEqual(mailStatus('Gmail check: 3 new email(s) read, 2 update(s) recorded'),
    {title: 'Check complete', sentence: '3 emails reviewed. 2 application records changed.', emails: 3, updates: 2});
  assert.deepEqual(mailStatus('Gmail check: 0 new email(s) read, 0 update(s) recorded'),
    {title: 'Check complete', sentence: 'No new job emails, and no application records changed.', emails: 0, updates: 0});
  assert.deepEqual(mailStatus(''), {title: 'Check complete', sentence: '', emails: null, updates: null});  // nothing to claim
});

test('the prep message becomes the interview, its topics, the next step and the consent line', () => {
  const report = parseMailReport(PREP, 'Gmail check: 1 new email(s) read, 0 update(s) recorded');
  assert.equal(report.status.sentence, '1 email reviewed. No application records changed.');
  assert.deepEqual(report.interview, {
    when: 'Tomorrow 08:30', company: 'Huxley', title: 'Principal SRE',
    summary: 'Follow up Igor / Jaya - SRE', where: 'Microsoft Teams Meeting',
    people: ['Seosahai - Nejati', 'Jayantie'],
  });
  assert.deepEqual(report.topics, ['Tenure / commitment', 'Customer bridge calls', 'Non-public-cloud infrastructure and security']);
  assert.deepEqual(report.nextSteps, [  // the pipeline's own clause boundary is where the paragraphs break
    'Recruiter to follow up on nationality/location constraints and salary expectations.',
    'With a further call planned to discuss compensation and contractual setup (B2B vs employee).',
  ]);
  assert.equal(report.consent, 'Recording? Ask everyone for consent at the start.');
  assert.equal(report.url, 'https://app.notion.com/p/Principal-SRE-via-Huxley-3ea62be8fd8681299dd8cc115550b8da');
  assert.deepEqual(report.notes, []);  // every line found its place
});

test('the other three shapes are notes, and none of them is read as an interview', () => {
  const nudge = parseMailReport('🎤 How did Huxley — Principal SRE go? Send the transcript (or /interview with your notes) with the caption ", Connect Igor / Jaya - SRE" for a review.', 'Gmail check: 5 new email(s) read, 1 update(s) recorded');
  assert.equal(nudge.interview, null);
  // fromRow marks where the line came from: a report line is drawn as the card's own structured section, never as a note.
  assert.deepEqual(nudge.notes, [{icon: '🎤', text: 'How did Huxley — Principal SRE go? Send the transcript (or /interview with your notes) with the caption ", Connect Igor / Jaya - SRE" for a review.', fromRow: false}]);

  const calendar = parseMailReport([
    '📧 Job emails and calendar',
    '❓ Huxley — SRE: an interview, but which job? Add the details in Jobadabra (Focus → Add details: paste the LinkedIn chat or the job link).',
    '🗓 Huxley — SRE: Teams meeting scheduled with recruiter Jayantie Nejati · Wed 30 Sep 08:30',
  ].join('\n'), 'Gmail check: 3 new email(s) read, 2 update(s) recorded');
  assert.equal(calendar.interview, null);                     // a colon after the company, not " — " around the title
  assert.equal(calendar.notes.length, 2);                    // its heading repeats the strip (6 Oct 2026)
  assert.equal(calendar.notes[0].icon, '❓');
  assert.match(calendar.notes[0].text, /^Huxley — SRE: an interview/);

  const quiet = parseMailReport('📧 Gmail checked: no new job emails.', 'Gmail check: 0 new email(s) read, 0 update(s) recorded');
  assert.equal(quiet.status.sentence, 'No new job emails, and no application records changed.');
  assert.deepEqual(quiet.notes, []);                          // the strip says it: no second "no new emails" under it
  assert.equal(parseMailReport('', ''), null);
  assert.equal(parseMailReport(null, null), null);
});

test('a missing link or missing people does not invent them', () => {
  const bare = parseMailReport([
    '🗓 Today 14:00 — Basler Kantonalbank — Software Engineer',
    'Interview with the team',
  ].join('\n'), '');
  assert.deepEqual(bare.interview, {
    when: 'Today 14:00', company: 'Basler Kantonalbank', title: 'Software Engineer',
    summary: 'Interview with the team', where: '', people: [],
  });
  assert.equal(bare.url, '');
  assert.equal(bare.consent, '');
  assert.equal(bare.status.sentence, '');
});

// A check that sent nothing to Telegram (no update worth telling you about, or Telegram off) has no message: its
// Notion report lines are then the only account of what it did — and those now name what it changed.
test('without a message the report lines say what the check recorded and changed', () => {
  const row = ['Gmail check: 2 new email(s) read, 1 update(s) recorded; AI cost $0.004.',   // the status already says this
               '📬 Application received · Canonical — Software Engineer - Data Infrastructure · Stage Applied → Confirmation received',
               'Emails with claude-haiku-4-5: 2 of 2; tokens in 3252 (+0 cached), out 142; $0.0040'];  // not about the emails
  const report = parseMailReport(null, 'Gmail check: 2 new email(s) read, 1 update(s) recorded', row);
  assert.deepEqual(report.status, {title: 'Check complete', sentence: '2 emails reviewed. 1 application record changed.', emails: 2, updates: 1});
  // The update is its own line — the job, and what moved on it — not a note.
  assert.deepEqual(report.updates, [{summary: 'Application received', job: 'Canonical — Software Engineer - Data Infrastructure',
                                     changes: 'Stage Applied → Confirmation received'}]);
  // The run's own lines are marked, so the card can draw them as sections instead of as loose text.
  assert.ok(report.notes.every(note => note.fromRow));
  assert.equal(parseMailReport(null, '', []), null);  // no message and no report: nothing to draw
});

// The two lines src/notion/cron_runs.py writes about the emails, as the card reads them.
test('each email read becomes a row: subject, who sent it, when, what was done with it', () => {
  const row = ['Gmail check: 2 new email(s) read, 1 update(s) recorded; AI cost $0.004.',
               '📬 Application received · Canonical — Software Engineer - Data Infrastructure · Stage Applied → Confirmation received; Confirmation email set',
               'Security code for your application to Canonical · Greenhouse · 01 Oct 03:44 — [read] · Canonical · nothing to record',
               'Thank you for applying to Canonical · us.greenhouse-mail.io · 01 Oct 03:45 — [recorded] · Canonical — Software Engineer - Data Infrastructure · changed Stage Applied → Confirmation received; Confirmation email set'];
  const report = parseMailReport(null, '', row);
  assert.deepEqual(report.updates, [{summary: 'Application received', job: 'Canonical — Software Engineer - Data Infrastructure',
                                     changes: 'Stage Applied → Confirmation received; Confirmation email set'}]);
  assert.deepEqual(report.emails, [
    {subject: 'Security code for your application to Canonical', sender: 'Greenhouse', time: '01 Oct 03:44',
     action: 'read', by: 'Canonical', changes: 'nothing to record'},
    {subject: 'Thank you for applying to Canonical', sender: 'us.greenhouse-mail.io', time: '01 Oct 03:45',
     action: 'recorded', by: 'Canonical — Software Engineer - Data Infrastructure',
     changes: 'Stage Applied → Confirmation received; Confirmation email set'}]);
});

// "Stage Applied → Confirmation received; Confirmation email set" as the card's two pills. A bug here showed the
// first pill as "[object HTMLElement], → Confirmation received" (an array handed to el(), which takes one node or
// text), so the split is its own tested function now.
test('one update change becomes a movement and a flag', () => {
  assert.deepEqual(mailChanges('Stage Applied → Confirmation received; Confirmation email set'),
    [{from: 'Stage Applied', to: 'Confirmation received'}, {flag: 'Confirmation email set'}]);
  assert.deepEqual(mailChanges('Next interview Thu 01 Oct 12:30 → Fri 02 Oct 09:00'),
    [{from: 'Next interview Thu 01 Oct 12:30', to: 'Fri 02 Oct 09:00'}]);
  assert.deepEqual(mailChanges(''), []);
});

test('an email that is not about the applications is not listed, older runs included', async () => {
  const {parseMailLines} = await import('../renderer/mail-report.js');
  const record = parseMailLines(['summary',
    'Your receipt from Anthropic Ireland, Limited #2695-4622 · Anthropic Ireland, Limited · 02 Oct 02:31 — [not about your applications]',
    'Thank you for applying · us.greenhouse-mail.io · 01 Oct 02:56 — [recorded] · Canonical — SRE · changed Stage Applied → Confirmation received']);
  assert.deepEqual(record.emails.map(email => email.action), ['recorded']);
});

test('a "which job?" line reads as answered once Focus no longer holds the question', () => {
  const open = [{headline: 'Blockdaemon: Meeting invitation', detail: 'Invitation from an unknown sender'}];
  assert.equal(settleQuestion('Blockdaemon — which job?', open), 'Blockdaemon — which job?');
  assert.equal(settleQuestion('Blockdaemon — which job?', []), 'Blockdaemon — which job? Answered in Focus');
  assert.equal(settleQuestion('Interview scheduled · Blockdaemon — which job?'.replace('Interview scheduled · ', ''), []), 'Blockdaemon — which job? Answered in Focus');
  assert.equal(settleQuestion('Blockdaemon: Meeting invitation … which job? Answer in Jobadabra (Focus).', []), 'Blockdaemon — which job? Answered in Focus');
  assert.equal(settleQuestion('Blockdaemon — which job?', null), 'Blockdaemon — which job?');   // Focus not loaded: no judgement
  assert.equal(settleQuestion('Canonical — SRE', []), 'Canonical — SRE');
});

test('a "which job?" stays an update (a side effect) and the email that raised it is told apart by its action', () => {
  const report = parseMailReport('', 'Gmail check: 2 new email(s) read, 2 update(s) recorded', [
    'Gmail check: 2 new email(s) read, 2 update(s) recorded',
    '📬 Application received · Canonical — SRE · Stage Applied → Confirmation received',
    '❓ Interview scheduled · Blockdaemon — which job?',
    'Meeting invitation · Cal.com · 02 Oct 21:30 — [needs you] · Blockdaemon']);
  assert.deepEqual(report.updates.map(update => [update.job, !!update.question]), [['Canonical — SRE', false], ['Blockdaemon', true]]);
  assert.equal(report.emails[0].action, 'needs you');
});

// The check of 5 Oct 2026 (the owner's screenshot): one email read, the rejection it recorded, and the AI's reading of it.
test('a rejection becomes the email\'s result: the update, its stage, and the AI assessment split in two', () => {
  const message = ['📧 Job emails & calendar', '2 updates', '',
    'Anthropic · Staff+ Software Engineer, Data Infrastructure · Rejected', 'Application rejected after consideration', '',
    '🛠 Why rejected · Anthropic — Staff+ Software Engineer, Data Infrastructure: Hard skills (medium). Staff-level data-infrastructure role needing a deep data/storage background (BigQuery, Airflow, dbt, Spark); your experience is SRE/platform.'].join('\n');
  const rows = ['Gmail check: 1 new email(s) read, 2 update(s) recorded',
    'Anthropic Follow-Up for Staff+ Software Engineer, Data Infrastructure | Igor · us.greenhouse-mail.io · 05 Oct 21:50 — [recorded] · Anthropic — Staff+ Software Engineer, Data Infrastructure'];
  const report = parseMailReport(message, rows[0], rows);
  assert.deepEqual(report.notes.filter(note => !note.fromRow), []);   // nothing left to draw as loose text (the card skips row lines)
  const {results, updates} = mailResults(report);
  assert.equal(results.length, 1);
  assert.deepEqual(updates, []);
  const [result] = results;
  assert.deepEqual([result.company, result.role, result.email.sender, result.email.time],
    ['Anthropic', 'Staff+ Software Engineer, Data Infrastructure', 'us.greenhouse-mail.io', '05 Oct 21:50']);
  assert.deepEqual([result.outcome.kind, result.outcome.summary], ['Rejected', 'Application rejected after consideration']);
  assert.deepEqual([result.assessment.verdict, result.assessment.confidence, result.assessment.focus, result.assessment.background],
    ['Hard skills', 'medium', 'Staff-level data-infrastructure role needing a deep data/storage background (BigQuery, Airflow, dbt, Spark).', 'SRE/platform.']);
});

test('an assessment with no "your experience" clause stays one sentence, and an unmatched update gets its own card', () => {
  const report = parseMailReport(['Acme · SRE · Rejected', 'No reason given', '',
    '❔ Why rejected · Acme — SRE: Unclear (low). The email gave no reason.'].join('\n'), 'Gmail check: 0 new email(s) read, 1 update(s) recorded', []);
  const [result] = mailResults(report).results;
  assert.equal(result.email, null);
  assert.deepEqual([result.company, result.role, result.assessment.focus, result.assessment.summary], ['Acme', 'SRE', '', 'The email gave no reason.']);
});

// Two real runs' report lines (Notion, 5 Oct 2026): one on GitHub (Always on), one on the Mac. Same card for both.
const GITHUB_RUN = [
  'Gmail check: 2 new email(s) read, 2 update(s) recorded; AI cost $0.048.',
  '❌ Rejected · Anthropic — Staff+ Software Engineer, Data Infrastructure · Stage Confirmation received → Rejected',
  '🛠 Why rejected · Anthropic — Staff+ Software Engineer, Data Infrastructure: Hard skills (medium). Staff-level data-infrastructure role needing a deep data/storage background (BigQuery, Airflow, dbt, Spark); your experience is SRE/platform.',
  'Anthropic Follow-Up for Staff+ Software Engineer, Data Infrastructure | Igor · us.greenhouse-mail.io · 05 Oct 21:50 — [recorded] · Anthropic — Staff+ Software Engineer, Data Infrastructure · changed Stage Confirmation received → Rejected',
];
const MAC_RUN = [
  'Gmail check: 22 new email(s) read, 2 update(s) recorded; Claude Code, your plan.',
  '❓ Interview · Notification: Igor Mardari and Blockdaemon DM @ Fri 2 Oct 2026 21:30 - 22:15 (CEST) (Igor Mardari) — which job? Add details',
  '🗓 Interview scheduled · Google Calendar — Notification: Igor Mardari and Blockdaemon DM @ Fri 2 Oct 2026 21:30 - · Fri 02 Oct 21:30 · Stage Screening → Interview scheduled',
  'Notification: Igor Mardari and Blockdaemon DM @ Fri 2 Oct 2026 21:30 - 22:15 (CEST) (Igor Mardari) · Google Calendar · 02 Oct 21:00 — [recorded] · Google Calendar — Notification: Igor Mardari and Blockdaemon DM @ Fri 2 Oct 20 · changed Stage Screening → Interview scheduled',
];

test('every recorded update is on screen, on its email\'s row or on its own, wherever the check ran', () => {
  const all = ({results, updates}) => [...results.map(r => r.update).filter(Boolean), ...updates];
  const github = mailResults(parseMailReport('', GITHUB_RUN[0], GITHUB_RUN));
  assert.deepEqual(all(github).map(u => [u.summary, u.changes]), [['Rejected', 'Stage Confirmation received → Rejected']]);
  assert.equal(github.results[0].update.summary, 'Rejected');             // on the Anthropic email's row
  assert.equal(github.results[0].assessment?.verdict, 'Hard skills');   // the review line is the assessment, not an update
  const mac = mailResults(parseMailReport('', MAC_RUN[0], MAC_RUN));
  assert.equal(all(mac).length, 2);
  assert.ok(all(mac).some(u => u.question));                              // "— which job? Add details" is the question
});

test('emails the check read but left out are counted, so the card never claims rows it does not show', () => {
  const report = parseMailReport('', GITHUB_RUN[0], GITHUB_RUN);
  assert.equal(mailResults(report).hidden, 1);
});

// 6 Oct 2026: a run this Mac kept ("updates" from its log, a "Mail: …" summary) drew a bare bullet, and a check that read
// one email and changed nothing drew no card at all. Both are the same card as a Notion row's.
test('a run kept on this Mac reads as the same card: its updates go to What changed, its summary gives the counts', () => {
  const report = parseMailReport('', 'Mail: 6 new email(s) classified, 1 update(s)', ['', '💬 Reply received · Acme Robotics — SRE']);
  assert.deepEqual([report.status.emails, report.status.updates], [6, 1]);
  assert.deepEqual(report.updates.map(u => [u.summary, u.job]), [['Reply received', 'Acme Robotics — SRE']]);
});

test('a check that read an email and changed nothing still has its card: the counts and the email it set aside', () => {
  const report = parseMailReport('', 'Gmail check: 1 new email(s) read, 0 update(s) recorded', ['Gmail check: 1 new email(s) read, 0 update(s) recorded']);
  assert.ok(report);
  assert.deepEqual([report.status.emails, report.status.updates, mailResults(report).hidden], [1, 0, 1]);
});

test('"No new job emails" is the strip\'s own sentence: the message adds no notes under it', () => {
  const report = parseMailReport('📧 Gmail checked\nNo new job emails', 'Gmail check: 0 new email(s) read, 0 update(s) recorded', []);
  assert.deepEqual(report.notes, []);
  assert.equal(report.status.sentence, 'No new job emails, and no application records changed.');
});

// 6 Oct 2026: "2 emails reviewed, 2 updates recorded" over one email row and one change. The strip counts what the card lists.
test('the strip counts the rows the card shows: new emails, the relevant ones, and What changed', async () => {
  const {mailCounts} = await import('../renderer/mail-report.js');
  const rows = ['Gmail check: 2 new email(s) read, 2 update(s) recorded',
    '❌ Rejected · Anthropic — Staff+ SWE · Stage Confirmation received → Rejected',
    '🛠 Why rejected · Anthropic — Staff+ SWE: Hard skills (medium). Needs data depth.',
    'Follow-Up | Igor · us.greenhouse-mail.io · 05 Oct 21:50 — [recorded] · Anthropic — Staff+ SWE · changed Stage Confirmation received → Rejected'];
  assert.deepEqual(mailCounts(parseMailReport('', rows[0], rows)),
    [{value: 2, label: 'new emails'}, {value: 1, label: 'relevant'}, {value: 1, label: 'update recorded'}]);
  // every email listed: just "reviewed"
  assert.deepEqual(mailCounts(parseMailReport('', 'Gmail check: 1 new email(s) read, 1 update(s) recorded', [rows[0], rows[1], rows[3]])).map(c => c.label),
    ['email reviewed', 'update recorded']);
  // a run kept on this Mac lists no emails: its own count, no claim about relevance
  assert.deepEqual(mailCounts(parseMailReport('', 'Mail: 6 new email(s) classified, 1 update(s)', ['', '💬 Reply received · Acme — SRE'])),
    [{value: 6, label: 'emails reviewed'}, {value: 1, label: 'update recorded'}]);
  assert.deepEqual(mailCounts(parseMailReport('', 'Gmail check: 0 new email(s) read, 0 update(s) recorded', [])), []);
});

test('an email about the interview the band describes is covered: its row keeps the job and the stage move only', () => {
  const run = JSON.parse(fs.readFileSync(new URL('../e2e/fixtures/mail-states.json', import.meta.url), 'utf8')).states
    .find(state => state.name.startsWith('7 emails')).run;
  const {results, updates} = mailResults(parseMailReport(run.message, run.result, run.report));
  assert.deepEqual(updates, []);                                   // every update is on its email's card
  const covered = results.filter(r => r.covered).map(r => r.company);
  assert.deepEqual(covered, ['Huxley']);                          // only the interview the panel describes
  assert.equal(results.find(r => r.company === 'Huxley').update.changes, 'Stage Screening → Interview scheduled');
  assert.equal(results.filter(r => r.update?.question).length, 3);  // the three which-job questions, on their emails
});

test('the line under a check with no email cards agrees with the strip\'s own count (issue #343)', () => {
  // A run kept on this Mac says "3 updates recorded" but kept no email rows: the card must not also say nothing changed.
  for (const [message, expect] of [
    ['Gmail check: 3 new email(s) read, 3 update(s) recorded', /3 updates recorded.*no details/i],
    ['Gmail check: 2 new email(s) read, 1 update(s) recorded', /1 update recorded.*no details/i],
    ['Gmail check: 2 new email(s) read, 0 update(s) recorded', /No application records changed/]]) {
    const line = mailNoCards(parseMailReport('', message));
    assert.match(line, expect, message);
    if (/[1-9] update\(s\) recorded/.test(message)) assert.doesNotMatch(line, /No application records changed/, message);
  }
});

test('a Gmail check that did not finish draws no result card: never "No new job emails" under "Not checked" (issue #359)', () => {
  const zero = 'Gmail check: 0 new email(s) read, 0 update(s) recorded';
  assert.equal(mailCardShown({ok: true, result: zero}), true);                         // a finished check with nothing new: the green strip says so
  assert.equal(mailCardShown({ok: false, result: zero}), false);                       // the sign-in expired: the inbox was never read
  assert.equal(mailCardShown({ok: true, interrupted: true, result: zero}), false);     // stopped part way: no claim about the inbox
  assert.equal(mailCardShown({ok: true, off: true}), false);                           // Gmail not connected: nothing was checked
  assert.equal(mailCardShown({ok: false, updates: ['💬 Reply received · Acme — SRE']}), true);   // what it did record before failing is still shown
  assert.equal(mailCardShown({ok: false, report: ['', '✅ Applied · Acme — SRE']}), true);
});
