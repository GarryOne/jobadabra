import assert from 'node:assert/strict';
import {test} from 'node:test';
import {latestStep, readSessionMessage} from '../renderer/session-message.js';

// The shape of a real final report (fictional details).
const REPORT = `The Example Labs application (Engineering Manager, London) is filled in the open Chrome tab and ready for you to review and click Submit. Nothing was submitted.

- **Extension:** it returned an error, so I filled the whole form myself.
- **Filled:** all the required fields plus the optional ones.
- **Yes/No questions:**
  - On-prem Kubernetes experience: No
  - Will need sponsorship: Yes
- **Nothing left empty.** This form has no education section.
- **Check before you submit:**
  - The infrastructure answer says you don't have on-prem Kubernetes experience.
  - It's a UK role, so you'll need visa sponsorship.
- **Run record:** saved to Notion. The form checker didn't detect the CV, so I marked it attached by hand.`;

test('a report: only the "Check before you submit" items are for you; the audit and the rest are apart', () => {
  const {checks, needs, audit, done, intro} = readSessionMessage(REPORT);
  assert.deepEqual(checks, []);
  assert.deepEqual(needs, [
    "The infrastructure answer says you don't have on-prem Kubernetes experience.",
    "It's a UK role, so you'll need visa sponsorship.",
  ]);
  assert.match(audit, /^saved to Notion\. .*by hand\.$/);
  assert.deepEqual(done.map(section => section.label), ['Extension', 'Filled', 'Yes/No questions', 'Nothing left empty']);
  assert.deepEqual(done[2].items, ['On-prem Kubernetes experience: No', 'Will need sponsorship: Yes']);
  assert.equal(intro.length, 1);
});

test('a short question: its bullets are what to check, the audit paragraph is found', () => {
  const {checks, audit, done, intro} = readSessionMessage(
    'Please check these answers:\n\n- **Visa:** "Yes"\n- The salary field\n\n**Audit file:** fixed one row.\n\nShall I leave them?');
  assert.deepEqual(checks, ['**Visa:** "Yes"', 'The salary field']);
  assert.equal(audit, 'fixed one row.');
  assert.deepEqual(done, []);
  assert.deepEqual(intro, ['Please check these answers:', 'Shall I leave them?']);
});

test('the latest step: the last ● line of the terminal output, without colours or cursor moves', () => {
  const output = '\x1b[1m●\x1b[0m Kit found; opening the form now.\r\n  Called claude-in-chrome\r\n' +
    '\x1b[38;5;15m●\x1b[39m\x1b[1CForm\x1b[1Copen with the extension hook present.\r\n\x1b[2K> ';
  assert.equal(latestStep(output), 'Form open with the extension hook present.');
  assert.equal(latestStep('no steps yet'), '');
});

test('the checks split into what Claude needs from you and what happened; a ❓ carries its suggested answer', async () => {
  const {sortChecks, readAsk} = await import('../renderer/session-message.js');
  const {needs, filled} = sortChecks([
    'Name, email and phone, and your LinkedIn.',
    'Dropdowns:',
    'The extension failed on this page ("api is not defined"), so I filled everything myself.',
    "❓ **Bachelor's degree result**: no grade is on file. **Suggested:** 8.5 / 10 (guess)",
    '❓ **Maths at high school**: the kit\'s "Top 20%" is a guess.',
    '⚖️ **AI-use pledge**: these are agreements, so you choose them yourself.',
    "Your answers say you have no Ceph experience. Make sure you're happy disclosing that.",
  ]);
  assert.deepEqual(needs.map(need => need.kind), ['ask', 'ask', 'agree', 'confirm']);
  assert.deepEqual(needs.slice(0, 2).map(({question, why, suggested}) => ({question, why, suggested})), [
    {question: "Bachelor's degree result", why: 'no grade is on file.', suggested: '8.5 / 10 (guess)'},
    {question: 'Maths at high school', why: 'the kit\'s "Top 20%" is a guess.', suggested: ''}]);
  assert.deepEqual(filled.map(item => item.problem), [false, true]);
  assert.equal(readAsk('❓ **Notice period:** none. Suggested: 3 months').question, 'Notice period');
  assert.equal(readAsk('No question here'), null);
});

test('a report with heading lines ("**Left for you:**" then bullets): its items are for you, the rest is what happened', async () => {
  const {sortChecks} = await import('../renderer/session-message.js');
  const {checks, needs, done, audit, intro} = readSessionMessage(`The Acme form is filled and open in Chrome. Nothing was submitted.

**How I got to the form:** the page loads the form in a frame, so I opened it directly.

**Filled (19 fields):**
- Name, email, phone
- Cover letter pasted, CV attached last

**Left for you:**
- ⚠️ Art. 13 GDPR notice (required) is a legal acknowledgment, so you tick it.
- ⚠️ Any relatives or partners working at Acme? (required) Also no source.
- "First generation to attend university?" (optional): no source.

**Kit checks before sending:**
- The posting names Go; you have none.

**Run record:** saved to Notion.

Review everything, then Submit yourself.`);
  assert.deepEqual(done.map(section => [section.label, section.items.length]), [['How I got to the form', 0], ['Filled (19 fields)', 2]]);
  assert.deepEqual(checks, []);
  assert.equal(audit, 'saved to Notion.');
  assert.equal(intro.length, 2);
  const sorted = sortChecks(needs, {forYou: true}).needs;
  assert.deepEqual(sorted.map(need => need.kind), ['agree', 'ask', 'ask', 'confirm']);
  assert.deepEqual(sorted.slice(1, 3).map(need => need.question), ['Any relatives or partners working at Acme?', 'First generation to attend university?']);
});

test('"Check before you submit" items are for you (a labelled fact too), with the action Claude recommends', async () => {
  const {sortChecks} = await import('../renderer/session-message.js');
  const {needs} = readSessionMessage(`The form is filled. Nothing was submitted.

- **Extension:** it failed again, so I filled everything myself.

**Check before you submit:**
- ⚠️ **Location:** the role wants someone in the UK or Ireland.
- **Pay:** €117k–141k, below your minimum. **Recommended:** apply anyway
- The extension failed on the upload, so I attached the CV by hand.`);
  const {needs: sorted, filled} = sortChecks(needs, {forYou: true});
  assert.deepEqual(sorted.map(need => [need.kind, need.label, need.recommended]), [['confirm', 'Location', ''], ['confirm', 'Pay', 'apply anyway']]);
  assert.equal(sorted[1].text, '**Pay:** €117k–141k, below your minimum.');
  assert.deepEqual(filled.map(item => item.problem), [true]);
});

test('a test or a file named in backticks is developer chatter: no card for it', async () => {
  const {sortChecks, DEV_TALK} = await import('../renderer/session-message.js');
  const {needs, filled} = sortChecks([
    "`test_watch` (`wanted_title('Infrastructure Tax Lead')`) it most likely fails because the tests read your edited `config/search.json`.",
    '`test_paths` (`JOBADABRA_TEST_VAR` not loaded): I haven\'t traced it.',
    '⚠️ Any relatives working at N26? (required) Also no source.'], {forYou: true});
  assert.deepEqual([needs.length, filled.length], [1, 0]);
  assert.equal(DEV_TALK.test('Do you know `Terraform` or Git?'), false);
});

test('repo vocabulary is developer talk in anything Claude says to the applicant', async () => {
  const {isDevTalk} = await import('../renderer/session-message.js');
  for (const line of ['Both failures also occur on a clean checkout of `HEAD`, so they are not caused by anything I did.',
    'I ran the same two tests in a temporary worktree with your uncommitted config changes left out.',
    'My earlier guess was that `test_watch` read your edited `config/search.json`.']) assert.equal(isDevTalk(line), true, line);
  for (const line of ['Any relatives working at N26? (required)', 'The N26 form is filled. Review it and click Submit.']) assert.equal(isDevTalk(line), false, line);
});

test('a Needs-you item that is a reply to Claude is recognised; bold marks are not words', async () => {
  const {replyOf, unbold} = await import('../renderer/session-message.js');
  assert.equal(replyOf('Reply **ok**, and I\'ll click Create an account and go on to the application form.'), 'ok');
  assert.equal(replyOf('Reply "yes" when done'), 'yes');
  assert.equal(replyOf('Tick **"Je ne suis pas un robot"** in Chrome.'), '');
  assert.equal(replyOf('Replying to recruiters is faster'), '');
  assert.equal(unbold('Tick **"Je ne suis pas un robot"** in Chrome.'), 'Tick "Je ne suis pas un robot" in Chrome.');
});
