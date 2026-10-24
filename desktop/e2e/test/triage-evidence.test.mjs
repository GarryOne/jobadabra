// What an issue of the UI loop carries (a screenshot, the app's state, the logs, labels for severity and kind), how a repeat finding is recognised although the AI words it
// differently, the human "confirmed" fast lane, and the "no longer seen" comment with the new screenshot. gh and the screenshot upload are stubs: no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {triage} from '../triage.mjs';
import {CONFIRMED, factsRows, issueBody, labelsFor, matchExisting, pickCandidate, screenshotOf, similar} from '../lib/triage.mjs';

const RUN = 'https://github.com/o/r/actions/runs/777';
const URL1 = 'https://raw.githubusercontent.com/o/r/pr-assets/ui-loop/fp/777-focus.png';

function artifacts({ui = [], ai = [], failures = [], pngs = [], withAi = true, facts = null, logs = null} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
  const dir = path.join(root, 'e2e-artifacts-focus');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'ui-findings.json'), JSON.stringify(ui));
  if (withAi) fs.writeFileSync(path.join(dir, 'ai-findings.json'), JSON.stringify({findings: ai}));
  fs.writeFileSync(path.join(dir, 'suite-failures.json'), JSON.stringify(failures));
  for (const name of pngs) fs.writeFileSync(path.join(dir, name), 'png');
  if (facts) fs.writeFileSync(path.join(dir, 'ui-focus.json'), JSON.stringify(facts));
  if (logs) { fs.mkdirSync(path.join(dir, 'logs')); for (const [name, text] of Object.entries(logs)) fs.writeFileSync(path.join(dir, 'logs', name), text); }
  return root;
}
// A gh that remembers what it was asked: issues listed, created, commented, edited.
function stub(initial = []) {
  const state = {issues: initial, created: [], comments: [], edits: [], prComments: [], prs: [], labels: []};
  const gh = args => {
    const [a, b] = args;
    if (a === 'issue' && b === 'list' && args.includes('top-issues')) return JSON.stringify(state.ranking ? [state.ranking] : []);   // the pinned ranked list (refreshRanking)
    if (a === 'issue' && b === 'list') return JSON.stringify(state.issues);
    if (a === 'issue' && b === 'create' && /^🔥/.test(args[3])) { state.ranking = {number: 900, id: 'node900', body: args[5]}; return 'https://github.com/o/r/issues/900\n'; }
    if (a === 'issue' && b === 'edit' && args[2] === '900') { state.ranking = {...state.ranking, body: args[args.indexOf('--body') + 1]}; return ''; }
    if (a === 'issue' && b === 'edit' && args.includes('--add-label') && /^priority:/.test(args[args.indexOf('--add-label') + 1])) { (state.priorities ||= []).push({number: args[2], label: args[args.indexOf('--add-label') + 1], removed: args.filter((x, i) => args[i - 1] === '--remove-label')}); return ''; }
    if (a === 'issue' && b === 'view') return JSON.stringify({id: 'node900'});
    if (a === 'api') return '';
    if (a === 'issue' && b === 'create') { state.created.push({title: args[3], body: args[5], labels: args[7]}); return ''; }
    if (a === 'issue' && b === 'comment') { state.comments.push({number: args[2], body: args[4]}); return ''; }
    if (a === 'issue' && b === 'close') { (state.closed ||= []).push({number: args[2], reason: args[4]}); return ''; }
    if (a === 'issue' && b === 'edit') { state.edits.push(args.slice(2)); return ''; }
    if (a === 'pr' && b === 'list') return JSON.stringify(state.prs);
    if (a === 'pr' && b === 'comment') { state.prComments.push({number: args[2], body: args[4]}); return ''; }
    if (a === 'label') { state.labels.push(args[2]); return ''; }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return {gh, state};
}
const publish = uploads => ({files}) => { const out = {}; for (const {to} of files) { uploads.push(to); out[to] = `https://raw.githubusercontent.com/o/r/pr-assets/${to}`; } return out; };
const aiFinding = {view: 'focus', severity: 'medium', kind: 'layout', title: 'Header title overlaps DEV badge', detail: 'The DEV badge sits on top of the Focus title and covers the F.', suggestion: 'Move the badge.'};
const openIssue = (number, title, kind, labels = [], comments = [], detail = 'The DEV badge sits on the Focus title.') => ({number, state: 'OPEN', title, body: `**MEDIUM** · ${kind} · found by the AI screenshot review\n\n${detail}`,
  labels: [{name: 'auto-ui'}, {name: `fp:old${number}`}, ...labels.map(name => ({name}))], comments});

test('an issue shows the screenshot, the app state, the severity and where to look', () => {
  const body = issueBody({...aiFinding, id: 'fp1', source: 'ai-review'}, RUN, {suite: 'focus', screenshot: URL1, facts: {page: 'focus', aiEngineChosen: 'api', notionConnected: true, jobsInList: 0, situation: 'default'}, codeFile: 'desktop/renderer/pages/focus.js'});
  assert.match(body, /^🟠 \*\*MEDIUM\*\* · layout · found by the AI screenshot review/);
  assert.match(body, /\n> 📍 Page `focus` · suite `focus`\n/, 'a short where-and-on-what block follows the verdict line');
  assert.ok(body.includes(`![focus](${URL1})`));
  assert.match(body, /<details><summary>App state when this was taken<\/summary>[\s\S]*- \*\*Page:\*\* focus/, 'the app state is collapsed, as a short list');
  assert.match(body, /node suite\.mjs focus/);
  assert.match(body, /desktop\/renderer\/pages\/focus\.js/);
  assert.match(body, /e2e-artifacts-focus/);
  assert.match(body, /fingerprint: fp1/);
});

test('the labels say severity, kind, view, suite and source, so the list can be filtered', () => {
  assert.deepEqual(labelsFor({...aiFinding, severity: 'high', source: 'ai-review'}, 'focus'), ['severity:high', 'kind:layout', 'view:focus', 'suite:focus', 'source:ai-review']);
});

test('the app facts become table rows, empty ones left out', () => {
  assert.deepEqual(factsRows({page: 'focus', settingsSection: '', aiEngineChosen: 'cli', notionConnected: false, jobsInList: 3, situation: 'x'}),
    [['Page', 'focus'], ['AI engine', 'cli'], ['Notion connected', 'no'], ['Jobs in the list', '3'], ['Situation', 'x']]);
});

test('a new finding is filed with its screenshot (uploaded), facts and labels', () => {
  const uploads = [], {gh, state} = stub();
  const root = artifacts({ai: [aiFinding], pngs: ['ui-focus.png'], facts: {page: 'focus', jobsInList: 0}});
  const out = triage({artifacts: root, runUrl: RUN, gh, publish: publish(uploads), repo: 'o/r'});
  assert.equal(out.filed.length, 1);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0], /^ui-loop\/[^/]+\/777-ui-focus\.png$/);
  assert.match(state.created[0].body, /!\[focus\]\(https:\/\/raw\.githubusercontent\.com\/o\/r\/pr-assets\/ui-loop\//);
  assert.match(state.created[0].body, /- \*\*Page:\*\* focus/);
  assert.match(state.created[0].labels, /severity:medium.*kind:layout.*view:focus/);
});

test('a screenshot that cannot be uploaded does not stop the issue', () => {
  const {gh, state} = stub();
  const root = artifacts({ai: [aiFinding], pngs: ['ui-focus.png']});
  triage({artifacts: root, runUrl: RUN, gh, publish: () => { throw new Error('push refused'); }, repo: 'o/r'});
  assert.equal(state.created.length, 1);
  assert.ok(!state.created[0].body.includes('!['));
});

test('the same problem worded differently is the same finding: a sighting is added, not a new issue', () => {
  const {gh, state} = stub([openIssue(40, '[auto-ui] focus: DEV badge covers the page title', 'layout')]);
  const root = artifacts({ai: [aiFinding], pngs: ['ui-focus.png']});
  const out = triage({artifacts: root, runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
  assert.deepEqual([out.filed.length, out.again.length], [0, 1]);
  assert.equal(state.comments[0].number, '40');
  assert.match(state.comments[0].body, /^Seen again in run /);
  assert.ok(state.comments[0].body.includes('!['), 'the new run\'s screenshot is in the comment');
});

test('an unrelated finding of the same page is its own issue', () => {
  assert.equal(similar('Header title overlaps DEV badge', 'Side column missing from two-column layout') < 0.3, true);
  const {gh, state} = stub([openIssue(40, '[auto-ui] focus: Side column missing from two-column layout', 'layout', [], [], 'The page shows one column; the side column is not there.')]);
  const out = triage({artifacts: artifacts({ai: [aiFinding]}), runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
  assert.deepEqual([out.filed.length, out.again.length], [1, 0]);
  assert.equal(state.created.length, 1);
});

test('a human can confirm a finding: it is ready without a second sighting; a parked one is not', () => {
  const real = openIssue(38, '[auto-ui] focus: x', 'text', [CONFIRMED]);
  assert.equal(pickCandidate([real])?.number, 38);
  assert.equal(pickCandidate([openIssue(38, '[auto-ui] focus: x', 'text', [CONFIRMED, 'needs-human'])]), null);
  assert.equal(pickCandidate([openIssue(38, '[auto-ui] focus: x', 'functionality', [CONFIRMED])])?.number, 38, 'a confirmed logic finding is fixable since 4 Oct 2026 (engine scope)');
  assert.equal(pickCandidate([openIssue(38, '[auto-ui] focus: x', 'test-failure', [CONFIRMED])]), null, 'a failed test step is still not the fixer\'s');
  assert.equal(pickCandidate([openIssue(38, '[auto-ui] focus: x', 'text')]), null, 'unconfirmed with one sighting');
  assert.equal(pickCandidate([openIssue(38, '[auto-ui] focus: x', 'text', [CONFIRMED, 'not-seen-latest'])]), null, 'a finding that no longer shows is not fixed');
});

test('a finding whose page was photographed and reviewed again but did not come back is marked, with the new screenshot', () => {
  const uploads = [], {gh, state} = stub([openIssue(37, '[auto-ui] focus: Side column missing from two-column layout', 'layout')]);
  state.prs = [{number: 99}];
  const root = artifacts({ai: [], pngs: ['ui-focus.png']});
  const out = triage({artifacts: root, runUrl: RUN, gh, publish: publish(uploads), repo: 'o/r'});
  assert.equal(out.gone.length, 1);
  assert.match(state.comments[0].body, /^Not seen in run /);
  assert.ok(state.comments[0].body.includes('!['));
  assert.ok(state.edits.some(edit => edit.includes('not-seen-latest')));
  assert.equal(state.prComments[0].number, '99', 'the open fix pull request gets the same after-picture');
});

test('no review in that run means no "gone": the page was not looked at', () => {
  const {gh, state} = stub([openIssue(37, '[auto-ui] focus: Side column missing from two-column layout', 'layout')]);
  const out = triage({artifacts: artifacts({ai: [], pngs: ['ui-focus.png'], withAi: false}), runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
  assert.equal(out.gone.length, 0);
  assert.equal(state.comments.length, 0);
});

test('a failed suite step carries the step\'s message, its screenshot and the last log lines', () => {
  const uploads = [], {gh, state} = stub();
  const step = 'a transcript fails to review';
  const root = artifacts({failures: [{suite: 'focus', step, message: 'boom'}], pngs: ['failed-a-transcript-fails-to-review.png', 'last.png'], logs: {'engine.log': 'one\ntwo\nthree', 'app.log': 'app line'}});
  triage({artifacts: root, runUrl: RUN, gh, publish: publish(uploads), repo: 'o/r'});
  assert.match(uploads[0], /failed-a-transcript-fails-to-review|failed/);
  assert.match(state.created[0].body, /<details>[\s\S]*three[\s\S]*<\/details>/);
  assert.match(state.created[0].body, /boom/);
});

test('the candidate\'s screenshot is read from its issue or its latest comment', () => {
  assert.equal(screenshotOf({body: `x ![a](${URL1}) y`, comments: []}), URL1);
  assert.equal(screenshotOf({body: 'no image', comments: [{body: 'older ![a](https://raw.githubusercontent.com/o/r/pr-assets/a.png)'}, {body: `newer ![b](${URL1})`}]}), URL1);
  assert.equal(screenshotOf({body: 'none', comments: []}), '');
});

test('matchExisting finds the issue by fingerprint first, then by the same view, kind and words', () => {
  const issues = [openIssue(1, '[auto-ui] focus: Side column missing', 'layout'), openIssue(2, '[auto-ui] focus: DEV badge covers the title', 'layout')];
  assert.equal(matchExisting({...aiFinding, id: 'zzz'}, issues)?.number, 2);
  assert.equal(matchExisting({...aiFinding, kind: 'text', id: 'zzz'}, issues), null);
});

// A false positive is closed with wontfix-auto "so it never comes back": the richer matching must not forget that for a finding worded differently, nor reopen it for the same one.
const closedFalsePositive = (number, title, kind, detail) => ({...openIssue(number, title, kind, ['wontfix-auto'], [], detail), state: 'CLOSED'});

test('a finding that was closed as a false positive is not filed again, even worded differently', () => {
  const closed = closedFalsePositive(41, '[auto-ui] focus: Side column missing from two-column layout', 'layout', 'The page shows one column; the side column is not there.');
  for (const finding of [{...aiFinding, title: 'Side column missing from two-column layout', detail: 'The side column is not there on the page.'}]) {
    const {gh, state} = stub([closed]);
    const out = triage({artifacts: artifacts({ai: [finding]}), runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
    assert.deepEqual([out.filed.length, out.again.length, state.created.length], [0, 0, 0]);
  }
});

test('a finding closed because it was fixed comes back as a new issue when it returns', () => {
  const fixed = {...openIssue(30, '[auto-ui] focus: DEV badge covers the title', 'layout'), state: 'CLOSED'};
  const {gh, state} = stub([fixed]);
  const out = triage({artifacts: artifacts({ai: [aiFinding]}), runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
  assert.equal(out.filed.length, 1);
  assert.equal(state.created.length, 1);
});

// 2 Oct 2026: a run on an empty AI credit filed seven "step failed" issues: four were one cascade, the rest the AI saying "Credit balance is too low".
test('only the first failed step of a suite is filed; the later ones are listed as what failed after it', () => {
  const {gh, state} = stub();
  const root = artifacts({failures: [{suite: 'focus', step: 'first step', message: 'boom'}, {suite: 'focus', step: 'second step', message: 'needs the first'}, {suite: 'focus', step: 'third step', message: 'needs the first'}]});
  const out = triage({artifacts: root, runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
  assert.equal(out.filed.length, 1);
  assert.match(state.created[0].title, /first step/);
  assert.match(state.created[0].body, /Failed after it[\s\S]*second step[\s\S]*third step/);
});

test('failures that come from the AI having no credit are not filed: the suite says so in its message or its logs', () => {
  for (const options of [
    {failures: [{suite: 'focus', step: 'a', message: 'timeout'}, {suite: 'focus', step: 'b', message: 'Review failed: The Anthropic API spend limit is reached, so the review is paused'}]},
    {failures: [{suite: 'focus', step: 'a', message: 'timeout'}], logs: {'engine.log': 'x\nBadRequestError: Your credit balance is too low to access the Anthropic API.\ny'}}]) {
    const {gh, state} = stub();
    const out = triage({artifacts: artifacts(options), runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
    assert.equal(state.created.length, 0, JSON.stringify(options).slice(0, 60));
    assert.equal(out.skipped.length, 1, 'it says what it skipped');
  }
});

test('a suite that tests the spend-limit message on purpose is not read as having no credit from its logs', () => {
  const {gh, state} = stub();
  const root = artifacts({failures: [{suite: 'activityfailures', step: 'the AI never answers', message: 'timeout'}], logs: {'engine.log': 'Your credit balance is too low to access the Anthropic API.'}});
  const dir = path.join(root, 'e2e-artifacts-focus'), moved = path.join(root, 'e2e-artifacts-activityfailures');
  fs.renameSync(dir, moved);
  triage({artifacts: root, runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
  assert.equal(state.created.length, 1);
});

test('a spill in the app chrome is one finding for the whole window (not one per page), with its element in the title and the page it was seen on as the picture', () => {
  const {gh, state} = stub();
  const uploads = [];
  const root = artifacts({ui: [{view: 'app-chrome', shot: 'focus', severity: 'warning', kind: 'spill', detail: 'div.brand content runs out of its box (140px of 72px): "Jobadabra DEV"'},
    {view: 'app-chrome', shot: 'jobs', severity: 'warning', kind: 'spill', detail: 'div.brand content runs out of its box (140px of 72px): "Jobadabra DEV"'},
    {view: 'app-chrome', shot: 'focus', severity: 'warning', kind: 'spill', detail: 'button.palette content runs out of its box (160px of 72px): "Search & commands"'}], pngs: ['ui-focus.png', 'ui-jobs.png'], withAi: false});
  const out = triage({artifacts: root, runUrl: RUN, gh, publish: publish(uploads), repo: 'o/r'});
  assert.equal(out.filed.length, 2, 'the brand and the search button, each once');
  assert.match(state.created[0].title, /spill on app-chrome: div\.brand/);
  assert.match(state.created[0].labels, /kind:spill/);
  assert.ok(uploads.some(name => /-ui-focus\.png$/.test(name)), 'the picture is the page the check ran on');
});

const BUILD = 'main @ abc1234 (scheduled run)';
const suiteIssue = (number, suite, labels = []) => ({number, state: 'OPEN', title: `[auto-ui] ${suite}: step failed: x`, body: `**HIGH** · test-failure · found by a run of the ${suite} suite (a step of the ${suite} suite failed)\n\nx`,
  labels: [{name: 'auto-ui'}, {name: `fp:${suite}-test-failure-q`}, ...labels.map(name => ({name}))], comments: []});

test('a new issue, a "seen again" and a "not seen" comment all name the build that was tested', () => {
  const fresh = stub(), r1 = triage({artifacts: artifacts({ai: [aiFinding], pngs: ['ui-focus.png']}), runUrl: RUN, gh: fresh.gh, publish: publish([]), repo: 'o/r', build: BUILD});
  assert.equal(r1.filed.length, 1);
  assert.ok(fresh.state.created[0].body.includes(`Build tested: ${BUILD}`));
  const again = stub([openIssue(40, '[auto-ui] focus: DEV badge covers the page title', 'layout')]);
  triage({artifacts: artifacts({ai: [aiFinding], pngs: ['ui-focus.png']}), runUrl: RUN, gh: again.gh, publish: publish([]), repo: 'o/r', build: BUILD});
  assert.ok(again.state.comments[0].body.includes(`Build tested: ${BUILD}`));
  const gone = stub([openIssue(37, '[auto-ui] focus: Side column missing from two-column layout', 'layout')]);
  triage({artifacts: artifacts({ai: [], pngs: ['ui-focus.png']}), runUrl: RUN, gh: gone.gh, publish: publish([]), repo: 'o/r', build: BUILD});
  assert.ok(gone.state.comments[0].body.includes(`Build tested: ${BUILD}`));
});

test('a second clean review closes the issue; the first one only marks it', () => {
  const marked = stub([openIssue(37, '[auto-ui] focus: Side column missing from two-column layout', 'layout')]);
  const first = triage({artifacts: artifacts({ai: [], pngs: ['ui-focus.png']}), runUrl: RUN, gh: marked.gh, publish: publish([]), repo: 'o/r', build: BUILD});
  assert.deepEqual([first.gone.length, first.closed.length], [1, 0]);
  const second = stub([openIssue(37, '[auto-ui] focus: Side column missing from two-column layout', 'layout', ['not-seen-latest'])]);
  const out = triage({artifacts: artifacts({ai: [], pngs: ['ui-focus.png']}), runUrl: RUN, gh: second.gh, publish: publish([]), repo: 'o/r', build: BUILD});
  assert.deepEqual(out.closed, [37]);
  assert.deepEqual(second.state.closed, [{number: '37', reason: 'completed'}]);
  assert.match(second.state.comments.at(-1).body, /^Closed: not seen in two runs in a row/);
});

test('an issue is not closed when the finding came back, when its page was not reviewed, or when this run was already told about', () => {
  const back = stub([openIssue(40, '[auto-ui] focus: DEV badge covers the page title', 'layout', ['not-seen-latest'])]);
  triage({artifacts: artifacts({ai: [aiFinding], pngs: ['ui-focus.png']}), runUrl: RUN, gh: back.gh, publish: publish([]), repo: 'o/r'});
  assert.equal(back.state.closed, undefined, 'it came back');
  const blind = stub([openIssue(37, '[auto-ui] focus: Side column missing', 'layout', ['not-seen-latest'])]);
  triage({artifacts: artifacts({ai: [], pngs: ['ui-focus.png'], withAi: false}), runUrl: RUN, gh: blind.gh, publish: publish([]), repo: 'o/r'});
  assert.equal(blind.state.closed, undefined, 'the AI did not look at that page in this run');
  const told = stub([{...openIssue(37, '[auto-ui] focus: Side column missing', 'layout', ['not-seen-latest']), comments: [{body: `Not seen in run ${RUN}`}]}]);
  triage({artifacts: artifacts({ai: [], pngs: ['ui-focus.png']}), runUrl: RUN, gh: told.gh, publish: publish([]), repo: 'o/r'});
  assert.equal(told.state.closed, undefined, 'one run counts once');
});

test('a failed-step issue is cleared only by a run of its suite with no failure at all', () => {
  // artifacts() makes the folder e2e-artifacts-focus: the suite "focus" ran.
  const clean = stub([suiteIssue(61, 'focus')]);
  const out = triage({artifacts: artifacts({}), runUrl: RUN, gh: clean.gh, publish: publish([]), repo: 'o/r'});
  assert.equal(out.gone.length, 1, 'its suite ran green: not seen');
  const other = stub([suiteIssue(61, 'apply')]);
  assert.equal(triage({artifacts: artifacts({}), runUrl: RUN, gh: other.gh, publish: publish([]), repo: 'o/r'}).gone.length, 0, 'another suite ran: says nothing about apply');
  const failing = stub([suiteIssue(61, 'focus', ['not-seen-latest'])]);
  const failedRun = triage({artifacts: artifacts({failures: [{suite: 'focus', step: 'something else broke', message: 'boom'}]}), runUrl: RUN, gh: failing.gh, publish: publish([]), repo: 'o/r'});
  assert.equal(failedRun.closed.length, 0, 'the suite failed on another step: the later steps never ran');
  const closing = stub([suiteIssue(61, 'focus', ['not-seen-latest'])]);
  assert.deepEqual(triage({artifacts: artifacts({}), runUrl: RUN, gh: closing.gh, publish: publish([]), repo: 'o/r'}).closed, [61]);
});

test('an issue from a seeded run says which path it walked and how to replay it; a fixed run says nothing', () => {
  const finding = {...aiFinding, id: 'fp1', source: 'ai-review'};
  const seeded = issueBody(finding, RUN, {suite: 'interactions', seed: 4242, window: [1024, 700]});
  assert.match(seeded, /Variation of this run: seed 4242, window 1024x700/);
  assert.match(seeded, /E2E_SEED=4242 node suite\.mjs interactions {4}# this run's path/);
  assert.doesNotMatch(issueBody(finding, RUN, {suite: 'interactions', seed: 0}), /Variation of this run/);
});

const chromeIssue = (number, title, view = 'failure-screenshot', labels = []) => ({number, state: 'OPEN', title: `[auto-ui] ${view}: ${title}`, body: '**HIGH** · text · found by the AI screenshot review\n\nx',
  labels: [{name: 'auto-ui'}, {name: `fp:chrome${number}`}, ...labels.map(name => ({name}))], comments: []});

test('a sidebar issue is cleared by a run whose layout check ran and found nothing in the chrome; closed after a second such run', () => {
  const first = stub([chromeIssue(55, 'Brand name clipped at sidebar edge')]);
  const out1 = triage({artifacts: artifacts({}), runUrl: RUN, gh: first.gh, publish: publish([]), repo: 'o/r'});
  assert.equal(out1.gone.length, 1, 'marked "not seen"');
  const second = stub([chromeIssue(55, 'Brand name clipped at sidebar edge', 'failure-screenshot', ['not-seen-latest'])]);
  assert.deepEqual(triage({artifacts: artifacts({}), runUrl: RUN, gh: second.gh, publish: publish([]), repo: 'o/r'}).closed, [55]);
});

test('a sidebar issue stays open while the chrome still has a finding, and an issue about something else is left alone', () => {
  const still = stub([chromeIssue(49, 'spill on app-chrome: nav.sidebar', 'app-chrome', ['not-seen-latest'])]);
  const root = artifacts({ui: [{view: 'app-chrome', severity: 'warning', kind: 'spill', chrome: true, detail: 'nav.sidebar content runs out of its box'}]});
  assert.equal(triage({artifacts: root, runUrl: RUN, gh: still.gh, publish: publish([]), repo: 'o/r'}).closed.length, 0);
  const other = stub([chromeIssue(59, 'Status bar contradicts Gmail and check state', 'failure-screenshot', ['not-seen-latest'])]);
  assert.equal(triage({artifacts: artifacts({}), runUrl: RUN, gh: other.gh, publish: publish([]), repo: 'o/r'}).closed.length, 0, 'a status-bar issue needs its own review');
});


const ranked = (number, severity, comments, labels = [], kind = 'layout') => ({number, state: 'OPEN', title: `[auto-ui] focus: finding ${number}`, createdAt: new Date().toISOString(),
  body: `**${severity}** · ${kind} · found by the AI screenshot review\n\nx`, labels: [{name: 'auto-ui'}, ...labels.map(name => ({name}))], comments: Array.from({length: comments}, () => ({body: 'Seen again in run x', createdAt: new Date().toISOString()}))});

test('priority: a wrong-app high finding seen twice is P0; the rest band by severity x sightings; a needs-human one stays on the list, a false positive does not', async () => {
  const {priorityOf, rankIssues} = await import('../lib/triage.mjs');
  assert.equal(priorityOf(ranked(1, 'HIGH', 1, [], 'functionality')), 'P0');
  assert.equal(priorityOf(ranked(2, 'HIGH', 1, [], 'text')), 'P1', 'a cosmetic high never blocks a release: P1 at most (3 x 2 = 6)');
  assert.equal(priorityOf(ranked(3, 'HIGH', 0, [], 'functionality')), 'P2', 'seen once: 3');
  assert.equal(priorityOf(ranked(3, 'HIGH', 0, ['confirmed'], 'functionality')), 'P0', 'a person confirmed it');
  assert.equal(priorityOf(ranked(4, 'MEDIUM', 0)), 'P3');
  assert.equal(priorityOf(ranked(5, 'MEDIUM', 1)), 'P2');
  const order = rankIssues([ranked(4, 'MEDIUM', 0), ranked(1, 'HIGH', 1, [], 'functionality'), ranked(5, 'MEDIUM', 1), ranked(6, 'HIGH', 0, ['needs-human']), ranked(8, 'HIGH', 3, ['wontfix-auto']), {...ranked(7, 'HIGH', 3), state: 'CLOSED'}]);
  assert.equal(order[0].issue.number, 1);
  assert.deepEqual(order.map(item => item.issue.number).sort(), [1, 4, 5, 6], 'a person is needed on #6 (it stays, marked); the false positive #8 and the closed #7 are gone');
  const {rankingBody} = await import('../lib/triage.mjs');
  assert.match(rankingBody(order), /🙋 needs a person · #6/);
});

test('after a run every open issue gets one priority label and the pinned list is written once and rewritten only when it changes', () => {
  const issues = [ranked(1, 'HIGH', 1, [], 'functionality'), ranked(5, 'MEDIUM', 1, ['priority:P3']), ranked(4, 'MEDIUM', 0, ['priority:P3'])];
  const {gh, state} = stub(issues);
  triage({artifacts: artifacts({}), runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
  assert.deepEqual(state.priorities.map(item => [item.number, item.label, item.removed]), [['1', 'priority:P0', []], ['5', 'priority:P2', ['priority:P3']]], 'only the changed ones are edited; #4 is still P3');
  assert.match(state.ranking.body, /\| 1 \| \*\*P0\*\* \| #1 /);
  assert.match(state.ranking.body, /P0: 1 · P1: 0 · P2: 1 · P3: 1 · 3 open/);
  const first = state.ranking.body;
  state.edits.length = 0;
  triage({artifacts: artifacts({}), runUrl: RUN, gh, publish: publish([]), repo: 'o/r'});
  assert.equal(state.ranking.body, first);
  assert.ok(!state.edits.some(edit => edit[0] === '900'), 'unchanged list: not rewritten');
});
