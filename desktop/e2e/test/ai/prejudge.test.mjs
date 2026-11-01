// Judging before filing (lib/prejudge.mjs): which findings, the prompt, the answer, and the noise register that remembers what was not filed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {asIssues, entryOf, judgeable, parseVerdicts, pendingOf, prejudgePrompt, registerBody, registerEntries, signatureVerdict, wordOf} from '../../lib/prejudge.mjs';
import {suppressedBy} from '../../lib/triage.mjs';

const finding = (id, severity, extra = {}) => ({id, view: 'app-chrome', kind: 'layout', severity, source: 'ai-review', title: `Sidebar clipped ${id}`, detail: 'the last icon is cut at 640 px', ...extra});

test('the most severe judgeable findings, at most the cap; a plain failed step is judged like any finding', () => {
  const list = pendingOf([finding('a', 'medium'), finding('b', 'high'), {...finding('c', 'medium'), source: 'suite-failure', kind: 'test-failure', detail: 'expected 3, saw 2'},
    {...finding('d', 'medium'), source: 'suite-failure', kind: 'test-failure', detail: 'Timeout 30000ms exceeded'}, finding('e', 'medium')], 3);
  assert.deepEqual(list.map(item => item.id), ['b', 'a', 'c']);
});

test('one prompt names every finding by id and its picture', () => {
  const text = prejudgePrompt(pendingOf([finding('a', 'medium', {screenshot: '.heal/shots/a.png'})]), 'BASE RULES');
  assert.match(text, /^BASE RULES/);
  assert.match(text, /## a\nDetector: ai-review/);
  assert.match(text, /Screenshot: \.heal\/shots\/a\.png/);
});

test('the answer is read per id; a real verdict without code that exists is not trusted', () => {
  const lines = file => (file === 'desktop/renderer/style.css' ? 1800 : 0);
  const text = '## a\nfalse-positive\nWhy: desktop/renderer/style.css:1700 scrolls on purpose.\n\n## b\nreal\nWhy: desktop/renderer/nope.js:3 is wrong.\n\n## zz\nreal\nWhy: x';
  const verdicts = parseVerdicts(text, ['a', 'b'], lines);
  assert.deepEqual(Object.keys(verdicts), ['a', 'b']);
  assert.equal(wordOf(verdicts.a), 'false-positive');
  assert.equal(wordOf(verdicts.b), 'needs-human');
  assert.equal(wordOf('banana'), 'needs-human');
});

test('the register keeps its JSON through its body, and a remembered finding is suppressed next run even in other words', () => {
  const entry = entryOf(finding('a', 'medium'), 'false-positive\nWhy: the menu scrolls on purpose.', '2026-10-10');
  const body = registerBody([entry]);
  assert.deepEqual(registerEntries(body), [entry]);
  assert.match(body, /\| 2026-10-10 \| app-chrome \| Sidebar clipped a \| false-positive \| the menu scrolls on purpose\. \|/);
  const again = {...finding('x', 'medium'), title: 'Sidebar clipped icon', detail: 'the last icon is cut at 640 px high'};
  assert.ok(suppressedBy(again, asIssues([entry])), 'alike words on the same page and kind');
  assert.equal(suppressedBy({...again, view: 'jobs'}, asIssues([entry])), null, 'another page is not the same finding');
  assert.deepEqual(registerEntries('no block'), []);
});

test('a run with verdicts: noise is not filed and is remembered, real is filed confirmed with its verdict, the next run drops the noise unjudged', async () => {
  const {triage} = await import('../../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prejudge-'));
  fs.mkdirSync(path.join(dir, 'e2e-artifacts-interactions'));
  const ai = {findings: [
    {view: 'focus', kind: 'layout', severity: 'medium', title: 'Sidebar icon clipped at short window', detail: 'the last menu icon is half cut at the bottom edge', impact: 'the person may think a page is missing'},
    {view: 'jobs', kind: 'functionality', severity: 'high', title: 'Retry offered though it cannot work', detail: 'Retry shows while no AI key is saved', impact: 'they press it and nothing happens'},
  ]};
  fs.writeFileSync(path.join(dir, 'e2e-artifacts-interactions', 'ai-findings.json'), JSON.stringify(ai));
  let register = null;
  const created = [], comments = [];
  const gh = args => {
    if (args[0] === 'issue' && args[1] === 'list') return args.includes('noise-register') ? JSON.stringify(register ? [register] : []) : '[]';
    if (args[0] === 'issue' && args[1] === 'create') {
      const title = args[args.indexOf('--title') + 1], body = args[args.indexOf('--body') + 1], labels = args.includes('--label') ? args[args.indexOf('--label') + 1] : '';
      if (labels === 'noise-register') { register = {number: 99, body}; return 'https://github.com/o/r/issues/99'; }
      created.push({title, labels}); return `https://github.com/o/r/issues/${created.length}`;
    }
    if (args[0] === 'issue' && args[1] === 'comment') comments.push(args[2]);
    return args[0] === 'pr' ? '[]' : '';
  };
  const pending = triage({artifacts: dir, runUrl: 'https://x/runs/1', gh, pendingOnly: true}).pending;
  assert.equal(pending.length, 2);
  assert.equal(created.length, 0, 'planning writes nothing');
  const byView = Object.fromEntries(pending.map(item => [item.view === 'app-chrome' ? 'focus' : item.view, item.id]));   // a sidebar finding is the app's chrome, whatever page it was seen on
  const verdicts = {[byView.focus]: 'false-positive\nWhy: the menu scrolls on purpose.', [byView.jobs]: 'real\nWhy: desktop/renderer/pages/jobs.js:1 offers it.'};
  const out = triage({artifacts: dir, runUrl: 'https://x/runs/1', gh, verdicts});
  assert.deepEqual(created.map(item => item.title).filter(title => title.startsWith('[auto-ui]')), ['[auto-ui] jobs: Retry offered though it cannot work']);
  assert.match(created[0].labels, /(^|,)confirmed(,|$)/);
  assert.deepEqual(comments, ['1']);
  assert.equal(out.judgedNoise.length, 1);
  assert.ok(out.dropped.some(item => /judged false-positive before filing/.test(item.why)));
  assert.match(register.body, /Sidebar icon clipped/);
  const next = triage({artifacts: dir, runUrl: 'https://x/runs/2', gh, pendingOnly: true});
  assert.deepEqual(next.pending.map(item => item.view), ['jobs'], 'the remembered noise is not judged again');
});

test('owner, 1 Nov 2026: only findings the judge let through use the 3-new-issues cap; noise never takes a slot from a real one (run 41314669803 filed 0, cut 7 unjudged)', async () => {
  const {triage} = await import('../../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const run = (views, noisy) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prejudge-cap-'));
    fs.mkdirSync(path.join(dir, 'e2e-artifacts-interactions'));
    const findings = views.map(view => ({view, kind: 'functionality', severity: 'medium', title: `Retry on ${view} cannot work`, detail: `Retry shows on ${view} while no AI key is saved`, impact: 'they press it and nothing happens'}));
    fs.writeFileSync(path.join(dir, 'e2e-artifacts-interactions', 'ai-findings.json'), JSON.stringify({findings}));
    const created = [];
    const gh = args => {
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      if (args[0] === 'issue' && args[1] === 'create') { const labels = args.includes('--label') ? args[args.indexOf('--label') + 1] : ''; if (labels !== 'noise-register') created.push(args[args.indexOf('--title') + 1]); return `https://github.com/o/r/issues/${created.length + 1}`; }
      return args[0] === 'pr' ? '[]' : '';
    };
    const pending = triage({artifacts: dir, runUrl: 'https://x/runs/1', gh, pendingOnly: true}).pending;
    const verdicts = Object.fromEntries(pending.map(item => [item.id, noisy.includes(item.view) ? 'false-positive\nWhy: by design.' : 'real\nWhy: desktop/renderer/pages/jobs.js:1 offers it.']));
    triage({artifacts: dir, runUrl: 'https://x/runs/1', gh, verdicts});
    return {pending: pending.map(item => item.view).sort(), filed: created.filter(title => title.startsWith('[auto-ui]')).map(title => title.split(':')[0].replace('[auto-ui] ', '')).sort()};
  };
  const five = run(['focus', 'jobs', 'actions', 'settings', 'strategy'], ['focus', 'jobs', 'actions']);
  assert.equal(five.pending.length, 5, 'every new finding is judged, not only the first three');
  assert.deepEqual(five.filed, ['settings', 'strategy'], 'the two real ones are filed though three noisy ones came first');
  const six = run(['focus', 'jobs', 'actions', 'settings', 'strategy', 'profile'], ['focus']);
  assert.equal(six.filed.length, 3, 'the cap still holds for findings the judge let through');
});

test('noise judged before filing still counts: a false positive of its detector for the numbers and the weekly lessons, but not for the breaker', async () => {
  const {classify, detectorOf, build} = await import('../../lib/selfheal-stats.mjs');
  const {noiseTripped} = await import('../../lib/plan.mjs');
  const {weekFacts} = await import('../../lib/finder-review.mjs');
  const entry = n => entryOf({...finding(`n${n}`, 'medium'), source: 'ai-review', title: `Ticker cut ${n}`}, `false-positive\nWhy: the ticker scrolls on purpose ${n}.`, '2026-10-11');
  const judged = asIssues([entry(1), entry(2), entry(3), entry(4), entry(5), entry(6), entryOf({...finding('h', 'medium'), source: 'layout-check'}, 'harness\nWhy: the demo data.', '2026-10-11')]);
  assert.equal(detectorOf(judged[0]), 'ai-review');
  assert.equal(classify(judged[0]), 'falsePositive');
  assert.equal(classify(judged[6]), 'harness');
  assert.equal(noiseTripped(judged).tripped, false, 'noise the judge caught before filing never reached the owner: it does not pause the review (9 Oct 2026)');
  const snapshot = build({issues: judged});
  assert.equal(snapshot.totals.filed, 7);
  assert.equal(snapshot.totals.falsePositive, 6);
  assert.equal(snapshot.verdicts.falsePositive, 6, 'the decorated verdict is counted');
  const facts = weekFacts(judged, {now: Date.parse('2026-10-12T00:00:00Z')});
  assert.match(facts, /the ticker scrolls on purpose 1/);
});

test('a known harness signature is judged harness without a model, and a step on a disabled control is judged, not filed raw (#84, #92, #95, #116, #117)', () => {
  const step = detail => ({...finding('s', 'high'), source: 'suite-failure', kind: 'test-failure', detail});
  assert.equal(wordOf(signatureVerdict(step('page.evaluate: Target page, context or browser has been closed'))), 'harness');
  assert.match(signatureVerdict(step('page.evaluate: Target page, context or browser has been closed')), /Why: the test or the probe lost its page/);
  assert.equal(wordOf(signatureVerdict({...finding('p', 'medium'), source: 'layout-check', kind: 'broken-resource', detail: 'failed to load: "file:///nonexistent-recall-plant.png"'})), 'harness');
  assert.equal(signatureVerdict(step('expected 3, saw 2')), '', 'an ordinary failed step is not a signature');
  assert.equal(judgeable(step('Target page, context or browser has been closed')), false, 'no model is needed for it');
  assert.equal(judgeable(step('page.click: waiting for element to be visible, enabled and stable - element is not enabled')), true, 'a disabled control may be a real bug: it is judged with the picture');
  assert.equal(judgeable(step('expected 3, saw 2')), true, 'every failed step is judged before filing (6 Oct 2026: 14 of 25 were the test\'s mistake)');
  assert.deepEqual(pendingOf([step('Target page, context or browser has been closed'), step('element is not enabled')].map((item, i) => ({...item, id: `x${i}`}))).map(item => item.id), ['x1']);
});

// 6 Oct 2026 (#306, #310, #315): the judge of a failed step reads its logs first; a screenshot alone could not show that the kit WAS drafted.
test('a failed step goes to the judge with its logs and the steps that failed after it', () => {
  const step = {id: 'f', view: 'apply', source: 'suite-failure', kind: 'test-failure', severity: 'medium', title: 'step failed: Apply on a saved job without a kit', detail: 'a form was opened', dir: '/art/apply', also: ['nothing was queued']};
  const [pending] = pendingOf([step]);
  assert.deepEqual(pending.logs, ['/art/apply/logs/engine.log', '/art/apply/logs/app.log']);
  const prompt = prejudgePrompt([pending], 'BASE');
  assert.match(prompt, /Logs: \/art\/apply\/logs\/engine\.log, \/art\/apply\/logs\/app\.log \(Read them before the screenshot/);
  assert.match(prompt, /Failed after it \(probably consequences\): nothing was queued/);
  assert.deepEqual(pendingOf([{...step, source: 'ai-review'}])[0].logs, [], 'a screenshot finding has no step logs');
});
