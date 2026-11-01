// The self-healing loop's rules as pure functions: severity, readiness, ranking, what a fix may touch, matching. (Part of the triage tests; the CLI half is triage-cli.test.mjs.)
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {issueBody, issueTitle, layoutSeverity, capNewAi, macTwin, matchExisting, normalize, TIMEOUT_FAILURE, notReadyReason, pickCandidate, sightings} from '../../lib/triage.mjs';

const issue = (number, fp, {severity = 'MEDIUM', kind = 'layout', comments = 0, state = 'OPEN', labels = []} = {}) => ({number, state,
  labels: [{name: 'auto-ui'}, {name: `fp:${fp}`}, ...labels.map(name => ({name}))],
  body: `**${severity}** · ${kind} · found by the AI screenshot review\n\ntext`, comments: Array.from({length: comments}, () => ({body: 'Seen again in run x'}))});

test('layout-check findings count as high or medium; low ones (any detector) are not filed; duplicates collapse', () => {
  const out = normalize({
    ui: [{view: 'jobs', severity: 'severe', kind: 'tall-row', detail: 'a row is 700px tall'}, {view: 'jobs', severity: 'warning', kind: 'clipped-text', detail: 'cut off'}, {view: 'jobs', kind: 'x'}],
    ai: [{view: 'settings', severity: 'low', kind: 'layout', title: 'minor', detail: 'x'}, {view: 'settings', severity: 'high', kind: 'layout', title: 'Cards cover the form', detail: 'y', id: 'settings-layout-1'},
      {view: 'settings', severity: 'high', kind: 'layout', title: 'Cards cover the form', detail: 'y again', id: 'settings-layout-1'},
      {view: 'settings', severity: 'high', kind: 'functionality', title: 'Save does nothing', detail: 'z', id: 'settings-functionality-1'}]});
  // A look-and-feel finding is high only for a wrong app (functionality, error-shown) or with a stated workaround (#50, #55, #56; 4 Oct 2026); low ones are not filed at all (4 Oct 2026).
  assert.deepEqual(out.map(item => [item.view, item.severity, item.source]), [['jobs', 'high', 'layout-check'], ['jobs', 'medium', 'layout-check'], ['settings', 'medium', 'ai-review'], ['settings', 'high', 'ai-review']]);
});

test('an issue is ready only after two sightings, for a kind a UI fix can address, with no pull request already open', () => {
  assert.equal(pickCandidate([issue(1, 'a')]), null, 'one sighting is not enough');
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1})])?.number, 1);
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1, kind: 'functionality'})]), null, 'a logic finding seen twice is still not confirmed');
  assert.equal(pickCandidate([issue(1, 'a', {kind: 'crash', labels: ['confirmed']})])?.number, 1, 'a confirmed logic finding (verdict pass or a person) is fixable since 4 Oct 2026');
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1})], {openBranches: ['auto-fix/a']}), null);
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1, labels: ['wontfix-auto']})]), null, 'a false positive stays closed');
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1, labels: ['needs-human']})]), null);
  assert.equal(pickCandidate([issue(1, 'a', {comments: 1, state: 'CLOSED'})]), null);
});

test('the most critical goes first: severity times how often it came back (old rule was severity first)', () => {
  const picked = pickCandidate([issue(1, 'a', {comments: 5, severity: 'MEDIUM'}), issue(2, 'b', {comments: 1, severity: 'HIGH'}), issue(3, 'c', {comments: 3, severity: 'HIGH'})]);
  assert.equal(picked.number, 1);   // 2 x 6 = 12, 3 x 4 = 12, 3 x 2 = 6: the tie goes to the older issue
});

test('issue text carries the fingerprint, severity and kind that the later steps read back', () => {
  const finding = {id: 'jobs-layout-abc', view: 'jobs', severity: 'high', kind: 'layout', title: 'Location cell 20 lines tall', detail: 'The row is 700px tall.', suggestion: 'Show two places.', source: 'ai-review'};
  assert.match(issueTitle(finding), /^\[auto-ui\] jobs: Location cell/);
  const body = issueBody(finding, 'https://github.com/x/actions/runs/1');
  assert.match(body, /\*\*HIGH\*\* · layout · found by the AI screenshot review/);
  assert.match(body, /fingerprint: jobs-layout-abc/);
  assert.equal(sightings({comments: [{body: 'Seen again in run 2'}, {body: 'a person wrote this'}]}), 2);
});

test('a failed suite step becomes one medium finding per step (a red step is not a blocked journey), whatever its message says', () => {
  const out = normalize({suite: [{suite: 'activity', step: 'the AI never answers', message: 'took 90 s'}, {suite: 'activity', step: 'the AI never answers', message: 'took 120 s'}, {suite: 'jobs', step: 'a jobs check', message: 'x'}, {step: 'no suite'}]});
  assert.deepEqual(out.map(item => [item.view, item.kind, item.severity, item.source, item.title]),
    [['activity', 'test-failure', 'medium', 'suite-failure', 'step failed: the AI never answers'], ['jobs', 'test-failure', 'medium', 'suite-failure', 'step failed: a jobs check']]);
  assert.match(out[0].detail, /took 90 s/);
});

test('a failed step is never ready for an automatic UI fix, however often it is seen', () => {
  const finding = normalize({suite: [{suite: 'activity', step: 's', message: 'm'}]})[0];
  const body = issueBody(finding, 'https://x/runs/1');
  assert.match(body, /a step of the activity suite failed/i);
  assert.equal(pickCandidate([{number: 1, state: 'OPEN', title: 't', body, labels: [{name: 'auto-ui'}, {name: `fp:${finding.id}`}], comments: [{body: 'Seen again in run 2'}, {body: 'Seen again in run 3'}]}]), null);
});

test('a layout finding\'s title quotes the text on the page, and its fingerprint is unchanged by it', () => {
  const ui = [{view: 'settings-narrow', severity: 'warning', kind: 'spill', detail: 'p#cv-message.message content runs out of its box (378px of 322px): "400 {"type":"error","error":{"type":"invalid_request_error"'}];
  const [finding] = normalize({ui});
  assert.equal(finding.title, 'spill on settings-narrow: p#cv-message.message', 'the title the fingerprint uses is as before');
  assert.equal(issueTitle(finding), '[auto-ui] settings-narrow: spill on settings-narrow: p#cv-message.message: "400 {"type":"error","error":{"type":"inv…"');
  const [again] = normalize({ui: [{...ui[0], detail: ui[0].detail.replace('378px', '380px')}]});
  assert.equal(again.id, finding.id);
});

// #94: a real bug (a raw API error in the CV message) that only showed while the API was failing was closed as "not seen in two runs" once the limit was raised.
test('a window-chrome defect from the AI review is one app-chrome finding, however it is worded and on whatever page', () => {
  const titles = ['Sidebar bottom icon clipped at window edge', 'Sidebar footer icon cut off at bottom', 'Sidebar\'s last icon cut off at bottom', 'Bottom sidebar icon is cut off', 'Sidebar bottom icon cut off by status bar'];
  const out = normalize({ai: titles.map((title, i) => ({view: ['jobs', 'focus', 'settings-narrow', 'calendar', 'actions'][i], severity: 'medium', kind: 'layout', title, detail: 'x'}))});
  assert.deepEqual([...new Set(out.map(item => `${item.view}|${item.id}`))], ['app-chrome|app-chrome-layout-bottom-clipped-icon-sidebar']);
  const [page] = normalize({ai: [{view: 'jobs', severity: 'medium', kind: 'consistency', title: 'Job counts disagree within the card', detail: 'x'}]});
  assert.equal(page.view, 'jobs', 'a finding about the page itself stays on its page');
});

// The verdict pass judged one finding per fixer run: a run that filed a dozen took days. ui-verdict.yml judges up to five at once.
test('the same bug seen from another variant of the page is the same issue; a different bug of that page family is not', () => {
  const open = (number, view, kind, title, found) => ({number, state: 'OPEN', title: `[auto-ui] ${view}: ${title}`, body: `**MEDIUM** · ${kind} · found by the AI screenshot review\n\n### What was found\n${found}\n\n### Evidence`, labels: [{name: 'auto-ui'}, {name: `fp:x${number}`}]});
  const issues = [open(105, 'activity-run-failed', 'consistency', 'Mixed 24-hour and 12-hour time formats', 'The run list shows 14:05 while the detail header says 2:05 PM and the status bar 2:05 PM.'),
    open(104, 'activity-run-failed', 'functionality', 'Failed run shows all steps with green checks', 'Every step has a green check although the run failed.')];
  const same = {view: 'activity-limit-paused', kind: 'consistency', title: 'Time formats differ on the same panel', detail: 'The list says 14:05 and the header 2:05 PM: two time formats on one panel.', id: 'new-1'};
  assert.equal(matchExisting(same, issues)?.number, 105);
  const other = {view: 'activity-limit-paused', kind: 'consistency', title: 'Limit banner repeats the reason', detail: 'The paused banner says the limit twice.', id: 'new-2'};
  assert.equal(matchExisting(other, issues), null, 'a different bug of the family stays its own issue');
  const elsewhere = {...same, view: 'calendar', id: 'new-3'};
  assert.equal(matchExisting(elsewhere, issues), null, 'another page family is never merged');
});

test('deterministic severities in the owner\'s levels: severe is high; tiny text and a tall cell are low; axe\'s impact sets accessibility (only critical is filed)', () => {
  assert.equal(layoutSeverity({severity: 'severe', kind: 'tall-row'}), 'high');
  assert.equal(layoutSeverity({severity: 'warning', kind: 'tiny-text'}), 'low');
  assert.equal(layoutSeverity({severity: 'warning', kind: 'clipped-text'}), 'medium');
  const axe = impact => ({severity: 'warning', kind: 'a11y', detail: `color-contrast on a, b (3 element(s), ${impact}, e.g. x): "Elements must meet minimum color contrast"`});
  assert.deepEqual(['critical', 'serious', 'moderate', 'minor'].map(impact => layoutSeverity(axe(impact))), ['medium', 'low', 'low', 'low']);
  assert.equal(layoutSeverity({severity: 'warning', kind: 'a11y', detail: 'no impact stated'}), 'medium');
});

test('a low finding is listed but neither judged nor fixed automatically; a person\'s confirmed still sends it', () => {
  const low = {number: 9, state: 'OPEN', title: 't', body: '🟢 **LOW** · layout · found by the AI screenshot review', labels: [{name: 'auto-ui'}, {name: 'fp:x'}], comments: [{body: 'Seen again'}]};
  assert.equal(notReadyReason(low), 'low-value');
  assert.equal(notReadyReason({...low, labels: [...low.labels, {name: 'confirmed'}]}), '');
});

test('a Windows finding the Mac already told is that issue\'s twin: open, or rejected; a Mac issue closed as fixed is not', () => {
  const mac = (number, state, extra = {}) => ({number, state, title: '[auto-ui] jobs: Raw Notion error in the Answer once card', body: '🟠 **MEDIUM** · text · found by the AI screenshot review\n\n### What was found\nThe card shows a raw Notion error.', labels: [{name: 'auto-ui'}, {name: 'fp:jobs-text-1'}, {name: 'platform:mac'}], comments: [], ...extra});
  const finding = {id: 'jobs-text-1-win', title: 'Raw Notion error in the Answer once card', detail: 'The card shows a raw Notion error.', view: 'jobs', kind: 'text'};
  assert.equal(macTwin(finding, [mac(1, 'OPEN')])?.number, 1);
  assert.equal(macTwin(finding, [mac(2, 'CLOSED', {stateReason: 'NOT_PLANNED'})])?.number, 2, 'a rejected Mac finding is not filed again from Windows');
  assert.equal(macTwin(finding, [mac(3, 'CLOSED', {stateReason: 'COMPLETED'})]), null, 'a fixed one that comes back on Windows may be a regression');
  assert.equal(macTwin(finding, [{...mac(4, 'OPEN'), labels: [{name: 'auto-ui'}, {name: 'platform:windows'}]}]), null, 'only Mac issues are twins');
});

test('only a failed step that ran out of time goes to the verdict pass', () => {
  assert.ok(TIMEOUT_FAILURE.test('page.waitForSelector: Timeout 60000ms exceeded.'));
  assert.ok(TIMEOUT_FAILURE.test('the app was still busy after 300 s of waiting for quiet'));
  assert.ok(TIMEOUT_FAILURE.test('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'), 'an HTML page from a service, not our JSON (#266)');
  assert.ok(!TIMEOUT_FAILURE.test('the tailored CV is not on the job\'s row in Notion'));
});

test('a run opens at most three new issues from the AI review, the highest severity first; other detectors and repeats are not capped', () => {
  const ai = (id, severity) => ({finding: {id, severity, source: 'ai-review'}, existing: null, twin: null});
  const plan = [ai('a', 'medium'), ai('b', 'medium'), ai('c', 'high'), ai('d', 'medium'), ai('e', 'medium'),
    {finding: {id: 'f', severity: 'medium', source: 'ai-review'}, existing: {number: 1}, twin: null},
    {finding: {id: 'g', severity: 'medium', source: 'suite-failure'}, existing: null, twin: null}];
  const kept = capNewAi(plan).map(item => item.finding.id);
  assert.deepEqual(kept, ['a', 'b', 'c', 'f', 'g'], 'the high one and the first two mediums; the repeat and the suite failure stay');
});

test('a console error is one finding whatever the page: copies fold in, and its id does not name a page', () => {
  const error = view => ({view, kind: 'console-error', severity: 'warning', source: 'layout-check', detail: 'window threw TypeError: "TypeError: within.contains is not a function"'});
  const out = normalize({ui: [error('apply-journey'), error('jobs-journey'), {...error('focus'), detail: 'window threw TypeError: "x is undefined"'}]});
  assert.equal(out.length, 2);
  const [merged, other] = out;
  assert.equal(merged.id, normalize({ui: [error('settings')]})[0].id, 'the same error on another page, in a later run, is the same issue');
  assert.doesNotMatch(merged.id, /journey/);
  assert.match(merged.detail, /Also thrown on: jobs-journey \(one error of the window/);
  assert.equal(merged.also, undefined, '`also` is the failed steps after a suite failure, not pages');
  assert.notEqual(other.id, merged.id);
  assert.equal(normalize({ui: [{...error('a'), detail: 'console Error: "line 12"'}]})[0].id, normalize({ui: [{...error('b'), detail: 'console Error: "line 40"'}]})[0].id, 'numbers folded');
});
