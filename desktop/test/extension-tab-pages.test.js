// Which tab may the extension touch? Chrome reuses a tab id after its tab closes, and the extension keeps per-tab
// state in session storage, so an id that comes back showing something else must never inherit a fill, a progress
// box or a "you submitted" check. 1 Oct 2026: a fill's box was painted onto a Google search page, and the
// submitted-check read the text of any other host.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startsOwnJob, kitStance, pickApplyButton, pickNamedButton, confirmationOf, forJob, missedConfirmation, navigationKind, neverForm, reportedIds, withMark, originOf, pageFingerprint, pageKey, pageRole, samePage, sameSite, submissionOutcome, SUBMIT_SETTLE_MS, SUBMIT_WAIT_MS, tabArmed, popupMode} from '../../extension/tab-pages.js';

const JOB = 'https://job-boards.greenhouse.io/canonical/jobs/3014391';

test('the panel runs only on a tab the desktop app opened', () => {
  assert.equal(tabArmed({url: `${JOB}#jobpilotto-fill`}), true);
  assert.equal(tabArmed({url: 'https://calendly.com/acme/30min', armed: true}), true);
  assert.equal(tabArmed({url: 'https://calendly.com/acme/30min'}), false);
  assert.equal(tabArmed({url: JOB}), false);
  assert.equal(tabArmed({}), false);
});

// 8 Oct 2026: a tab the app opened to apply showed the popup's "read this job list" buttons. Every kind of tab, one row each: a new kind
// added to popupMode without a row here fails.
test('the popup offers what fits the tab: apply, read by itself, read on a click, nothing', () => {
  const cases = [
    [{url: `${JOB}#jobpilotto-fill`}, 'fill'],
    [{url: 'https://www.jobs.ch/en/vacancies/detail/e644/#jobpilotto-fill'}, 'fill'],
    [{url: 'https://calendly.com/acme/30min', armed: true}, 'fill'],             // a later page of an apply tab
    [{url: 'https://www.notion.so/kit-123', armed: true}, 'browse'],             // an apply tab sent to Notion is let go
    [{url: 'https://www.jobs.ch/en/vacancies/#jp-read'}, 'read'],
    [{url: 'https://www.jobs.ch/en/vacancies/#jp-read-filter-ab12'}, 'read'],
    [{url: 'https://www.jobs.ch/en/vacancies/detail/e644/#jp-posting-ab12cd'}, 'read'],
    [{url: 'https://www.jobs.ch/en/vacancies/'}, 'browse'],
    [{url: 'chrome://extensions'}, 'none'],
    [{}, 'none'],
  ];
  for (const [tab, mode] of cases) assert.equal(popupMode(tab), mode, JSON.stringify(tab));
  assert.deepEqual([...new Set(cases.map(([, mode]) => mode))].sort(), ['browse', 'fill', 'none', 'read']);
});

test('a later page is a form, an account page, or neither', () => {
  assert.equal(pageRole({fields: 1}), 'no-form'); // a search box, or a job page with only an Apply button
  assert.equal(pageRole({}), 'no-form');
  assert.equal(pageRole({passwords: 1, fields: 2}), 'account'); // sign in
  assert.equal(pageRole({passwords: 2, fields: 8}), 'account'); // sign up: still Claude's, never auto-filled
  assert.equal(pageRole({fields: 12}), 'form');
  assert.equal(pageRole({fields: 1, files: 1}), 'form');
  assert.equal(pageRole({textareas: 1}), 'form');
  // A sign-in address is an account page before its password box shows (jobs.ch's Apply → auth.jobs.ch, email first).
  assert.equal(pageRole({fields: 1}, 'https://auth.jobs.ch/u/login/identifier?state=x'), 'account');
  assert.equal(pageRole({fields: 1}, 'https://acme.com/signin'), 'account');
  assert.equal(pageRole({fields: 1}, 'https://www.jobs.ch/en/vacancies/detail/84b8/'), 'no-form');
  assert.equal(pageRole({fields: 1}, 'https://acme.com/blog/how-to-login-faster'), 'no-form');
  assert.equal(pageRole({fields: 1}, 'not a url'), 'no-form');
});

test('a submit is asked about once the page changes, with or without a redirect', () => {
  const form = 'https://jobs.example/acme/apply';
  const at = 1_000;
  const before = pageFingerprint({title: 'Apply', headings: ['Apply'], text: 'First name', inputs: 8});
  const same = pageFingerprint({title: 'Apply', headings: ['Apply'], text: 'First name', inputs: 8});
  const thanks = pageFingerprint({title: 'Thank you', headings: ['Application received'], text: 'We have received your application', inputs: 0});
  assert.equal(before, same);
  assert.notEqual(before, thanks);
  assert.equal(submissionOutcome({at, now: at + 3000, from: form, to: form, before, after: same, stableFor: 3000}).why, 'waiting');
  assert.equal(submissionOutcome({at, now: at + SUBMIT_WAIT_MS, from: form, to: form, before, after: same, stableFor: 3000}).why, 'unchanged');
  const stayed = submissionOutcome({at, now: at + 5000, from: form, to: form, before, after: thanks, stableFor: SUBMIT_SETTLE_MS});
  assert.equal(stayed.ask, true);
  assert.equal(stayed.why, 'content');
  assert.equal(submissionOutcome({at, now: at + 3000, from: form, to: form, before, after: thanks, stableFor: 500}).why, 'waiting');
  const moved = submissionOutcome({at, now: at + 5000, from: form, to: `${form}/done?token=secret`, before, after: thanks, stableFor: SUBMIT_SETTLE_MS});
  assert.equal(moved.ask, true);
  assert.equal(moved.why, 'redirect');
  assert.equal(moved.path.endsWith('/done'), true);
  assert.equal(JSON.stringify(moved).includes('secret'), false);
  assert.equal(submissionOutcome({at, now: at + SUBMIT_WAIT_MS + 1, from: form, to: `${form}/done`, before, after: thanks, stableFor: 5000}).why, 'submit too old');
  assert.equal(submissionOutcome({now: at, from: form, to: `${form}/done`}).why, 'no submit');
});

test('the same page ignores the fill marker and a trailing slash', () => {
  assert.equal(samePage(`${JOB}#jobpilotto-fill`, JOB), true);
  assert.equal(samePage(`${JOB}/`, JOB), true);
  assert.equal(samePage(JOB, 'https://job-boards.greenhouse.io/canonical/jobs/5002072'), false);
  assert.equal(samePage('', JOB), false);
  assert.equal(samePage(JOB, undefined), false);
  assert.equal(pageKey(`${JOB}?utm=x#jobpilotto-fill`), `${JOB}?utm=x`);
});

test('a fill may keep drawing while the form moves inside its own site, never onto another', () => {
  const page = 'https://boards.greenhouse.io/acme/jobs/1';
  assert.equal(sameSite('https://boards.greenhouse.io/acme/jobs/1/apply', page), true);   // the ATS's next step
  assert.equal(sameSite('https://www.google.com/search?q=dubai+time', page), false);        // a random page
  assert.equal(sameSite('http://boards.greenhouse.io/acme/jobs/1', page), false);           // another scheme
  assert.equal(sameSite('not a url', page), false);
  assert.equal(originOf('https://x.test/a'), 'https://x.test');
  assert.equal(originOf(''), '');
});

test('only the job\'s own page or its confirmation counts as "this job"', () => {
  assert.equal(forJob(JOB, JOB), true);
  assert.equal(forJob(`${JOB}#jobpilotto-fill`, JOB), true);
  assert.equal(forJob('https://job-boards.greenhouse.io/canonical/jobs/3014391/confirmation', JOB), true);
  assert.equal(forJob('https://jobs.lever.co/acme/abc/thanks', 'https://jobs.lever.co/acme/abc'), true);
  // The case that was wrong: any other host passed (`elsewhere`), so a Google search page was read.
  assert.equal(forJob('https://www.google.com/search?q=thank+you+for+applying', JOB), false);
  assert.equal(forJob('https://job-boards.greenhouse.io/canonical/jobs/5002072', JOB), false);  // another role
  assert.equal(forJob('', JOB), false);
  assert.equal(forJob(JOB, ''), false);
});

test('a confirmation page with no stored job is logged, and only that page', () => {
  const page = 'https://job-boards.greenhouse.io/anthropic/jobs/5114768008/confirmation?token=secret';
  assert.deepEqual(confirmationOf(page), {host: 'job-boards.greenhouse.io', id: '5114768008', path: 'confirmation'});
  assert.equal(confirmationOf(JOB), null);
  assert.equal(confirmationOf('https://www.google.com/search?q=thank+you+for+applying'), null);
  assert.deepEqual(missedConfirmation({url: page}), {
    text: 'confirmation page, no job stored on this tab: not marked',
    fields: {host: 'job-boards.greenhouse.io', id: '5114768008', path: 'confirmation'},
  });
  assert.equal(missedConfirmation({url: page, job: 'https://job-boards.greenhouse.io/anthropic/jobs/5114768008'}), null);
  assert.equal(missedConfirmation({url: page, job: 'https://job-boards.greenhouse.io/anthropic/jobs/5002072'}).text,
    'confirmation page is not the job stored on this tab: not marked');
});

test('a session\'s form counts as open by the id in a reported tab address, and by nothing that merely looks like it', async () => {
  const {sessionsNamedIn} = await import('../lib/session-tab.js');
  const session = {id: 'a1', url: 'https://job-boards.greenhouse.io/n26/jobs/7768035', company: 'N26'};
  const embed = 'https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035';
  assert.deepEqual([...sessionsNamedIn([session], [`${embed}#jobpilotto-fill=a1`])], ['a1']);
  assert.deepEqual([...sessionsNamedIn([session], [embed, session.url])], []);
  assert.deepEqual([...sessionsNamedIn([session], [])], []);
});

test('an embedded Greenhouse confirmation carries the job id in ?token=, and counts for that job', async () => {
  const {forJob} = await import('../../extension/tab-pages.js');
  const job = 'https://job-boards.greenhouse.io/n26/jobs/7768035';
  assert.equal(forJob('https://job-boards.greenhouse.io/embed/job_app/confirmation?for=n26&token=7768035', job), true);
  assert.equal(forJob('https://job-boards.greenhouse.io/embed/job_app/confirmation?for=n26&token=1111111', job), false);
  assert.equal(forJob('https://job-boards.greenhouse.io/embed/job_app?for=n26&token=7768035', job), false);  // the form, not a confirmation
});

test('the user\'s Notion is never a job form: an armed tab sent there is let go', () => {
  assert.equal(neverForm('https://app.notion.com/p/Staff-Software-Engineer-6b262be8'), true);
  assert.equal(neverForm('https://www.notion.so/Job-Tracker'), true);
  assert.equal(neverForm('https://acme.notion.site/careers'), true);
  assert.equal(neverForm('https://job-boards.greenhouse.io/scaleai/jobs/4719479005'), false);
  assert.equal(neverForm('https://notion.example.org/apply'), false);
  // A search results page (Claude researching a company in the armed tab) is never a form; a real form on a Google host still is.
  assert.equal(neverForm('https://www.google.com/search?q=cursor+who+sits+behind'), true);
  assert.equal(neverForm('https://www.google.ch/search?q=acme'), true);
  assert.equal(neverForm('https://www.bing.com/search?q=acme'), true);
  assert.equal(neverForm('https://duckduckgo.com/?q=acme'), true);
  assert.equal(neverForm('https://docs.google.com/forms/d/e/abc/viewform'), false);
  assert.equal(neverForm('https://careers.google.com/jobs/results/123/apply'), false);
  assert.equal(neverForm('not a url'), false);
});

test('a person walking away ends the application tab; a page moving on keeps it, with the mark carried along', () => {
  for (const transitionType of ['typed', 'generated', 'auto_bookmark', 'start_page', 'keyword']) assert.equal(navigationKind({transitionType}), 'by-hand');
  assert.equal(navigationKind({transitionType: 'link', transitionQualifiers: ['from_address_bar']}), 'by-hand');
  for (const transitionType of ['link', 'form_submit', 'reload']) assert.equal(navigationKind({transitionType}), 'page');
  assert.equal(navigationKind({transitionType: 'link', transitionQualifiers: ['client_redirect']}), 'page');
  assert.equal(withMark('https://api.easytemp.ch/live/bew/1.php'), 'https://api.easytemp.ch/live/bew/1.php#jobpilotto-fill');
  assert.equal(withMark('https://x.test/a?b=1'), 'https://x.test/a?b=1#jobpilotto-fill');
  assert.equal(withMark('https://x.test/#/apply'), '');  // the page's own fragment is not touched
  assert.equal(withMark('chrome://settings'), '');
});

test('an armed form on any site counts as an open tab, a closed one does not', () => {
  assert.deepEqual(reportedIds({jobSiteIds: [3, 4], armedIds: [4, 7, 9], existingIds: [3, 4, 7, 12]}), [3, 4, 7]);
  assert.deepEqual(reportedIds({}), []);
});

test('the Apply button in front of a form is picked by rule: an apply phrase on its own, never sign-in, Easy Apply or a mail link', () => {
  const b = (text, extra = {}) => ({index: 0, text, tag: 'button', area: 20000, visible: true, disabled: false, href: '', ...extra});
  const pick = list => pickApplyButton(list.map((item, index) => ({...item, index})))?.text;
  assert.equal(pick([b('Share'), b('Apply for this Job')]), 'Apply for this Job');
  assert.equal(pick([b('Jetzt bewerben')]), 'Jetzt bewerben');
  assert.equal(pick([b('Postuler')]), 'Postuler');
  assert.equal(pick([b('Postuler »', {tag: 'a', href: '/talentcommunity/apply/1/'})]), 'Postuler »');   // jobs.coop.ch, 8 Oct 2026
  assert.equal(pick([b('Apply ❯')]), 'Apply ❯');
  assert.equal(pick([b('To apply', {tag: 'a', href: '/bewerbung/'})]), 'To apply');   // consultandpepper.com: the agency's own step before its form
  assert.equal(pick([b('Apply with LinkedIn'), b('Easy Apply'), b('Sign in to apply')]), undefined);
  assert.equal(pick([b('Apply now', {visible: false}), b('Apply now', {disabled: true})]), undefined);
  assert.equal(pick([b('Apply now', {tag: 'a', href: 'mailto:jobs@acme.com'})]), undefined);
  assert.equal(pick([b('Apply to jobs at Acme and 40 other companies today, sign up now!')]), undefined);   // a sentence, not a button
  // A form's own Submit is never the posting's Apply, whatever its words: "Postuler" on a SuccessFactors form still loading was its submit button
  // (SPAN#357:_submitBtn.rcmSaveButton, 9 Oct 2026). `submits` is read by structure in the page (apply-press.js applyCandidates).
  assert.equal(pick([b('Postuler', {tag: 'span', submits: true})]), undefined);
  assert.equal(pick([b('Postuler', {tag: 'span', submits: true}), b('Apply now')]), 'Apply now');
  assert.equal(pick([b('Apply', {tag: 'a', area: 900, href: '/x'}), b('Apply now', {area: 90000})]), 'Apply now');   // the larger, button-like one
  assert.equal(pick([]), undefined);
});

test('a kit that exists is a kit even when none of its answers fits the form: fill at once, no eligibility stop', () => {
  assert.deepEqual(kitStance({kitAnswers: [], hasKit: true}), {withKit: true, skipEligibility: true});           // Ashby: fields only seen on the page
  assert.deepEqual(kitStance({kitAnswers: [{field: 'x'}], hasKit: true, matched: 1}), {withKit: true, skipEligibility: true});
  assert.deepEqual(kitStance({kitAnswers: [{field: 'x'}], matched: 0}), {withKit: true, skipEligibility: false});  // answers, none on this form: the old rule
  assert.deepEqual(kitStance({}), {withKit: false, skipEligibility: false});                                       // no kit: Claude answers and checks first
});

test('a fill that used shared fixes says so: only controls that worked with a recipe count', async () => {
  const {sharedFixes, sharedFixNote} = await import('../../extension/tab-pages.js');
  const operated = [{kind: 'toggle-group', recipe: 2, ok: true}, {kind: 'date', recipe: 1, ok: true}, {kind: 'custom-select', recipe: 0, ok: true},
    {kind: 'toggle-group', recipe: 3, ok: false}, null];
  const used = sharedFixes(operated);
  assert.deepEqual(used, {count: 2, kinds: ['a Yes/No-style choice', 'a date field']});
  assert.match(sharedFixNote(used), /^Used 2 shared fixes from Jobadabra's service for a Yes\/No-style choice and a date field\..*never your answers.*Settings → Technical reports\.$/);
  assert.match(sharedFixNote({count: 1, kinds: ['a custom dropdown']}), /^Used 1 shared fix from/);
  assert.equal(sharedFixNote(sharedFixes([{kind: 'date', recipe: 0, ok: true}])), '');   // nothing from the service: nothing said
  assert.deepEqual(sharedFixes(undefined), {count: 0, kinds: []});
});

test('a start-applying phrase learned by the service is added to the built-in words, and never beats the not-a-button rules', async () => {
  const {pickApplyButton} = await import('../../extension/tab-pages.js');
  const candidate = (text, extra = {}) => ({index: 0, text, tag: 'button', area: 5000, visible: true, disabled: false, href: '', ...extra});
  const phrases = [{key: 'apply_button', phrase: 'ich möchte mich bewerben'}, {key: 'email', phrase: 'courriel'}, {key: 'apply_button', phrase: 'sign in'}];
  assert.equal(pickApplyButton([candidate('Ich möchte mich bewerben')]), null);                                     // not a built-in word
  assert.equal(pickApplyButton([candidate('Ich möchte mich bewerben *')], phrases)?.viaPhrase, 'ich möchte mich bewerben'); // learned, cleaned like the schema does
  assert.equal(pickApplyButton([candidate('Apply now')], phrases)?.viaPhrase, undefined);                      // a built-in word: not credited to the service
  assert.equal(pickApplyButton([candidate('Courriel')], phrases), null);                                       // a profile meaning is not a button phrase
  assert.equal(pickApplyButton([candidate('Sign in')], phrases), null);                                        // the not-a-button list wins, even over a bad phrase
  assert.equal(pickApplyButton([candidate('Ich möchte mich bewerben', {href: 'mailto:x@y.z'})], phrases), null);
  assert.equal(pickApplyButton([candidate('Ich möchte mich bewerben', {visible: false})], phrases), null);
});

test('a page the app opens starts its own job; the same page loading again (a form\'s result after Submit) keeps the job it has', () => {
  assert.equal(startsOwnJob(undefined, 'https://api.easytemp.ch/live/bew/1-FR.php#jobpilotto-fill'), true);
  assert.equal(startsOwnJob('https://boards.greenhouse.io/a/jobs/1', 'https://jobs.lever.co/b/2/apply#jobpilotto-fill'), true);
  assert.equal(startsOwnJob('https://api.easytemp.ch/live/bew/1-FR.php', 'https://api.easytemp.ch/live/bew/1-FR.php#jobpilotto-fill'), false);
});

test('Find jobs using your browser tabs are reported by ticket, from the mark or kept after a redirect dropped it', async () => {
  const {readTabs} = await import('../../extension/tab-pages.js');
  const tabs = [{id: 4, url: 'https://www.hublot.com/en-ch#jp-read-filter-3b887be2'}, {id: 7, url: 'https://www.omegawatches.com/careers'}, {id: 9, url: 'https://news.example'}];
  const {reading, mark} = readTabs(tabs, {7: 'c8fe5319', 12: 'gone0000'});
  assert.deepEqual(reading, {'3b887be2': 4, c8fe5319: 7}, 'a closed tab (12) is not reported; a tab without a mark or a kept ticket is not one');
  assert.deepEqual(mark, {4: '3b887be2'}, 'a newly seen mark is kept for after the redirect');
});

test('a tab reading one job posting is reported by its ticket too, so closing it or a restart of the extension is noticed', async () => {
  const {readTabs} = await import('../../extension/tab-pages.js');
  const {reading} = readTabs([{id: 5, url: 'https://www.linkedin.com/jobs/view/4012345678/#jp-posting-a1b2c3d4'}, {id: 6, url: 'https://x.example/#jp-postingx-a1b2c3d4'}]);
  assert.deepEqual(reading, {a1b2c3d4: 5});
});

test('a site the app opened that cannot be reached is said at once in plain words; an aborted load (a redirect) is not an error', async () => {
  const {unreachableWhy} = await import('../../extension/visit.js');
  assert.equal(unreachableWhy('net::ERR_NAME_NOT_RESOLVED'), 'no such address');   // www.geneva-freeport.ch, 7 Oct 2026
  assert.equal(unreachableWhy('net::ERR_CONNECTION_TIMED_OUT'), 'it did not answer');
  assert.equal(unreachableWhy('net::ERR_ABORTED'), '');
});

// Account pages and the application form kept apart (owner, 8 Oct 2026): one rule says which a page is, and an account page feeds
// nothing on the application side (learned answers, fill misses, "submitted").
test('a sign-in or sign-up page is told apart from the application form by one rule, for every learner', async () => {
  const {isAccountPage, pageRole} = await import('../../extension/tab-pages.js');
  const signIn = 'https://career55.sapsf.eu/careers?career_ns=job_application';
  assert.equal(pageRole({fields: 3, passwords: 1}, signIn), 'account');      // Manor's sign-in: email, password, "not a robot"
  assert.equal(pageRole({fields: 9, files: 1}, 'https://career55.sapsf.eu/careers/apply'), 'form');
  assert.equal(isAccountPage({role: 'account', page: signIn}, `${signIn}#jobpilotto-fill`), true);
  assert.equal(isAccountPage({role: 'form', page: signIn}, signIn), false);
  assert.equal(isAccountPage({role: 'account', page: signIn}, 'https://career55.sapsf.eu/careers/apply'), false);   // the rule was for another page
  assert.equal(isAccountPage(null, signIn, true), true);                       // the panel sees a password box now
  assert.equal(isAccountPage(undefined, signIn), false);
});

test('a page with both the account and the application (CV upload + password, Coop on SuccessFactors) is the application form', async () => {
  const {isAccountPage, pageRole} = await import('../../extension/tab-pages.js');
  const coop = 'https://career2.successfactors.eu/careers?company=Coop';
  assert.equal(pageRole({fields: 14, passwords: 2, files: 0, anyFiles: 1}, coop), 'form');   // "Upload a CV" hides its file input
  assert.equal(pageRole({fields: 14, passwords: 2}, coop), 'account');                       // many fields, no CV and no text box: a long sign-up
  assert.equal(pageRole({fields: 1, passwords: 1, textareas: 1}, coop), 'form');              // a cover-letter box
  assert.equal(pageRole({fields: 5, passwords: 2}, coop), 'account');                          // a sign-up: email, confirm, names, username
  // The rule's word wins over the panel's "there is a password box" (which a combined page has too).
  assert.equal(isAccountPage({role: 'form', page: coop}, coop, true), false);
});

test('a Portuguese Apply button the page-kind AI named is pressed with the same checks as the built-in words', async () => {
  const {pickApplyButton} = await import('../../extension/tab-pages.js');
  const buttons = [{index: 0, text: 'Partilhar', tag: 'button', area: 900, visible: true}, {index: 1, text: 'Candidatar-me', tag: 'button', area: 1200, visible: true},
    {index: 2, text: 'Candidatar-me', tag: 'a', area: 1200, visible: true, href: 'mailto:rh@emprego.example'}];
  assert.equal(pickApplyButton(buttons, []), null, 'no built-in word knows it');
  assert.equal(pickApplyButton(buttons, [{key: 'apply_button', phrase: 'candidatar-me'}])?.index, 1, 'the AI\'s phrase; never the mail link');
});

test('a button the page-kind AI named is pressed by its own text, not outscored by the posting\'s plain Apply behind a dialog (Workday, 10 Oct 2026)', () => {
  const b = (text, extra = {}) => ({text, tag: 'a', area: 15040, visible: true, disabled: false, href: '/apply/applyManually', ...extra});
  const list = [b('Apply', {area: 3840, href: '/apply'}), b('Apply Manually'), b('Use My Last Application'), b('Apply With LinkedIn')].map((item, index) => ({...item, index}));
  assert.equal(pickApplyButton(list, [{key: 'apply_button', phrase: 'Apply Manually'}]).text, 'Apply');   // the generic picker: the shorter built-in word wins (why the route press needs its own)
  assert.equal(pickNamedButton(list, 'Apply Manually').text, 'Apply Manually');
  assert.equal(pickNamedButton(list, 'apply  manually').text, 'Apply Manually');                           // case and spacing only
  assert.equal(pickNamedButton(list, 'Apply').index, 0);                                                     // an ordinary Apply named: that one
  assert.equal(pickNamedButton(list, 'Apply With LinkedIn'), null);                                           // floor: a third-party sign-in is never pressed
  assert.equal(pickNamedButton(list, 'Apply Later'), null);                                                  // not on the page: nothing, never a guess
  assert.equal(pickNamedButton(list, ''), null);
  // jobs.ch, 11 Oct 2026: a board's own "Easy apply" is pressed when the AI named it; without the AI the rule still refuses it.
  const easy = [b('Save', {tag: 'button', href: ''}), b('Easy apply', {tag: 'button', href: ''}), b('Apply With LinkedIn')].map((item, index) => ({...item, index}));
  assert.equal(pickNamedButton(easy, 'Easy apply').text, 'Easy apply');
  assert.equal(pickApplyButton(easy), null);
  assert.equal(pickApplyButton(easy, [{key: 'apply_button', phrase: 'easy apply'}])?.text, 'Easy apply');   // the generic press with the AI's phrase (0.9.180 still refused it here)
  assert.equal(pickApplyButton(easy, [{key: 'apply_button', phrase: 'apply with linkedin'}]), null);
  assert.equal(pickNamedButton([b('Apply Manually', {submits: true}), b('Apply Manually', {visible: false}), b('Apply Manually', {disabled: true})], 'Apply Manually'), null);
  assert.equal(pickNamedButton([b('Apply Manually', {href: 'mailto:a@b.c'})], 'Apply Manually'), null);
});
