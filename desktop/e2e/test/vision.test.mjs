// The AI review's answer is only trusted in a fixed shape; a stable fingerprint keeps one problem from becoming a PR every night.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SYSTEM, buildRequest, fingerprint, parseFindings, parseFindingsDetailed} from '../lib/vision.mjs';

test('only well-formed findings survive, with the page they were found on', () => {
  const reply = 'Here you go: ' + JSON.stringify({findings: [
    {severity: 'high', kind: 'layout', title: 'Location cell 20 lines tall', detail: 'The Jobs row is 700px tall.', impact: 'They scroll past one row for a full screen.', suggestion: 'Show two places and a count.'},
    {severity: 'urgent', kind: 'layout', title: 'bad severity', detail: 'x'},
    {severity: 'low', kind: 'taste', title: 'bad kind', detail: 'x'},
    {severity: 'low', kind: 'text', title: '', detail: 'empty title'},
    {severity: 'low', kind: 'layout', title: 'Tight spacing', detail: 'A few pixels.', impact: 'Barely noticeable spacing.'},
    {severity: 'medium', kind: 'text', title: 'No impact', detail: 'x'},
    'junk', null]});
  const out = parseFindings(reply, 'jobs');
  assert.deepEqual(out.map(item => [item.view, item.severity, item.kind, item.title]), [['jobs', 'medium', 'layout', 'Location cell 20 lines tall'], ['jobs', 'low', 'layout', 'Tight spacing']]);   // a layout finding is high only with a stated workaround
  const wrong = parseFindings(JSON.stringify({findings: [{severity: 'high', kind: 'functionality', title: 'Save does nothing', detail: 'x', impact: 'Their changes are lost without a word.'}, {severity: 'high', kind: 'error-shown', title: 'A stack trace', detail: 'y', impact: 'They see technical text and cannot act.'}, {severity: 'high', kind: 'text', title: 'Vague warning', detail: 'z', impact: 'They do not know what the warning asks of them.'}]}), 'jobs');
  assert.deepEqual(wrong.map(item => item.severity), ['high', 'high', 'medium'], 'only a wrong app can block a journey');
  const costly = parseFindings(JSON.stringify({findings: [{severity: 'high', kind: 'text', title: 'Two clocks', detail: 'x', impact: 'They compare two times on every run.', workaround: 'They must compare both times and guess which is right, every time they open a run.'}, {severity: 'high', kind: 'text', title: 'Vague', detail: 'y', impact: 'They have to read it twice.', workaround: 'ok'}]}), 'jobs');
  assert.deepEqual(costly.map(item => item.severity), ['high', 'medium'], 'very bad UX is high only when it says what the person must do and why it costs them');
  assert.deepEqual(parseFindings('no json at all', 'jobs'), []);
  assert.deepEqual(parseFindings('{"findings": "nope"}', 'jobs'), []);
});

test('the request carries the picture, the page and the expectations, on Sonnet by default (interpreting a screenshot is where a cheap model cries wolf)', () => {
  const request = buildRequest({view: 'jobs', pngBase64: 'AAAA', rules: 'rule one'});
  assert.equal(request.model, 'claude-sonnet-5-5');
  assert.equal(request.messages[0].content[0].source.data, 'AAAA');
  assert.match(request.messages[0].content[1].text, /Page: jobs[\s\S]*Expected to show:/);
  assert.match(request.system.at(-1).text, /design rules[\s\S]*rule one/);
});

test('the fixed part (instructions + design rules) comes first and is cached; what changes per page comes after it', () => {
  const a = buildRequest({view: 'jobs', pngBase64: 'AAAA', rules: 'rule one', facts: {x: 1}});
  const b = buildRequest({view: 'settings', pngBase64: 'BBBB', rules: 'rule one'});
  assert.deepEqual(a.system, b.system, 'the cached prefix must be byte-identical across pages, or nothing is ever read from the cache');
  assert.deepEqual(a.system.at(-1).cache_control, {type: 'ephemeral'});
  assert.equal(a.system.filter(block => block.cache_control).length, 1);
  assert.equal(JSON.stringify(a.messages).includes('rule one'), false, 'the rules are not sent twice');
  assert.deepEqual(buildRequest({view: 'jobs', pngBase64: 'AAAA'}).system.at(-1).cache_control, {type: 'ephemeral'}, 'no rules: the instructions alone are cached');
});

test('a review\'s cost comes from the API\'s own usage figures: input, cache write 1.25x, cache read 0.1x, output; an unknown model is not guessed', async () => {
  const {usageCost} = await import('../lib/vision.mjs');
  const usd = usageCost('claude-sonnet-5-5', {input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000, output_tokens: 500});
  assert.ok(Math.abs(usd - (1000 * 2 + 2000 * 2.5 + 10000 * 0.2 + 500 * 10) / 1e6) < 1e-12, String(usd));
  assert.equal(usageCost('claude-sonnet-5-5', {}), 0);
  assert.equal(usageCost('some-new-model', {input_tokens: 1}), null);
});

test('the same problem has the same fingerprint, a different one does not', () => {
  const a = {view: 'jobs', kind: 'layout', title: 'Location cell 20 lines tall'};
  assert.equal(fingerprint(a), fingerprint({...a, title: 'location cell, 20 lines tall!'}));
  assert.notEqual(fingerprint(a), fingerprint({...a, view: 'settings'}));
});

test('the reviewer is given the app\'s own facts and told to look for contradictions and misleading states, on any screenshot it finds', async () => {
  const {SYSTEM, expectedFor} = await import('../lib/vision.mjs');
  const request = buildRequest({view: 'settings-connections-cli-chosen', pngBase64: 'AAAA', facts: {aiEngineChosen: 'cli', anthropicKeySaved: true}});
  assert.match(request.messages[0].content[1].text, /FACTS about the app's state[\s\S]*"aiEngineChosen": "cli"[\s\S]*"anthropicKeySaved": true/);
  assert.match(SYSTEM, /CONTRADICTS the facts|CONTRADICT/);
  assert.match(SYSTEM, /MISLEAD/);
  assert.match(expectedFor('settings-connections-cli-chosen'), /"connections-cli-chosen" part of Settings/);
  assert.equal(buildRequest({view: 'jobs', pngBase64: 'AAAA'}).messages[0].content[1].text.includes('FACTS'), false, 'no facts, no facts block');
});

test('the request never carries a temperature: claude-sonnet-5-5 rejects it with a 400 (the nightly review did nothing for days because of it)', () => {
  const request = buildRequest({view: 'jobs', pngBase64: 'AAAA'});
  assert.equal('temperature' in request, false);
  assert.equal(request.model, 'claude-sonnet-5-5');
});

test('the activity suite\'s screenshots of failure and queued states are judged against what the Actions page and its panel should show', async () => {
  const {expectedFor} = await import('../lib/vision.mjs');
  for (const view of ['activity-run-failed', 'activity-run-warned', 'activity-limit-paused', 'activity-queued']) assert.match(expectedFor(view), /Recent activity panel/);
});

test('the review is told to report few findings, and a failure screenshot is not judged on the sidebar and the bottom bar (they made nine copies of one nitpick)', async () => {
  const {SYSTEM, expectedFor} = await import('../lib/vision.mjs');
  assert.match(SYSTEM, /Fewer, better[\s\S]*At most 3 findings per page/);
  assert.doesNotMatch(SYSTEM, /EVERY defect/);
  assert.match(expectedFor('failure-screenshot'), /not worth a finding here/);
});

// #98 (a toast over the header, "hides Refresh": invented) and #100 ("Gmail not connected" vs a follow-up built from logged events: a guess about the app's insides), 3 Oct 2026.
test('the review is told that transient UI and guesses about the app\'s insides are not findings', () => {
  assert.match(SYSTEM, /Do NOT report transient interface: a toast or notification/);
  assert.match(SYSTEM, /Do NOT report a guess about how the app works inside/);
  assert.match(SYSTEM, /A contradiction needs proof: two things you can SEE disagree, or the picture disagrees with a stated FACT/);
  assert.match(SYSTEM, /When you only suspect, say nothing/);
  assert.match(SYSTEM, /A picture freezes motion: a line that scrolls in a frame \(a ticker or marquee\)/, '#97: a scrolling tip ticker caught mid-scroll was reported as clipped text');
});

test('the review reads as a job seeker, not a design critic: the nitpick classes are named as never reported (#210, 4 Oct 2026)', () => {
  assert.match(SYSTEM, /person using the Jobadabra desktop app to find and win a job/);
  assert.match(SYSTEM, /visual style or consistency opinions \(emoji versus line icons/);
  assert.match(SYSTEM, /would this make me fail, lose time, misread something, or distrust the app/);
});

test('the review is told the app runs on made-up demo data and test-only states, which are not findings (#202, #217)', () => {
  assert.match(SYSTEM, /TEST profile with made-up demo data/);
  assert.match(SYSTEM, /recruiter-call-failing/);
});

test('an empty answer is the welcome answer: the prompt forbids inventing or padding findings', () => {
  assert.match(SYSTEM, /\{"findings":\[\]\} is the correct, expected and welcome answer/);
  assert.match(SYSTEM, /NEVER invent or pad a problem/);
});

test('the review looks hardest at the paths where a failure costs a person a job', () => {
  assert.match(SYSTEM, /Look hardest where a failure costs a person a job/);
  assert.match(SYSTEM, /silently loses or misstates their data/);
});

test('UI problems are noise only when they cost the person nothing: unreachable or cut-off controls at a supported size are real', () => {
  assert.match(SYSTEM, /A UI problem is NOT noise when it costs the person something/);
  assert.match(SYSTEM, /cannot navigate or reach a button, menu item or page/);
  assert.match(SYSTEM, /the smallest is 1024 x 640/);
  assert.doesNotMatch(SYSTEM, /NEVER report:[^.]*scrollbars/, 'scrollbars and narrow windows are no longer banned outright (the hidden menu scrollbar was a real bug)');
});

test('the review is told what was already judged by design, so it stops spending tokens on the same false positives (#97, #102, #130, #132)', () => {
  assert.match(SYSTEM, /Already judged BY DESIGN/);
  assert.match(SYSTEM, /text ticker/);
  assert.match(SYSTEM, /count different sets/);
});

test('the shape rules say what they dropped and why: malformed, no stated impact, more than six on a page', () => {
  const item = n => ({severity: 'medium', kind: 'text', title: `T${n}`, detail: 'd', impact: 'They lose a minute finding the way.'});
  const {kept, dropped} = parseFindingsDetailed(JSON.stringify({findings: [item(1), {...item(2), impact: ''}, {severity: 'urgent', kind: 'text', title: 'Bad', detail: 'x', impact: 'x'.repeat(20)}, item(3), item(4), item(5), item(6), item(7)]}), 'jobs');
  assert.deepEqual(kept.map(row => row.title), ['T1', 'T3', 'T4', 'T5']);
  assert.deepEqual(dropped.map(row => [row.title, row.why]), [['T2', 'no stated impact'], ['Bad', 'malformed'], ['T6', 'over 6 on one page'], ['T7', 'over 6 on one page']]);
});

test('the reviewer is told the test-mode and by-design states of #1789-#1791, #1764 and #1730 are not findings', () => {
  for (const words of [/end-to-end journey/, /Technical log that stays open/, /No search yet/]) assert.match(SYSTEM, words);
});

// Owner, 26 Oct 2026: Haiku 5.5 at its default effort saw 49% of the judged bugs; E2E_REVIEW_EFFORT lets it think harder, with room for that thinking.
test('an effort is sent to the model, and a high one gets room to think before the answer', () => {
  const plain = buildRequest({view: 'jobs', pngBase64: 'x'});
  assert.equal(plain.output_config, undefined);
  assert.equal(plain.max_tokens, 3000);
  const high = buildRequest({view: 'jobs', pngBase64: 'x', effort: 'high'});
  assert.deepEqual(high.output_config, {effort: 'high'});
  assert.ok(high.max_tokens >= 12000);
  assert.equal(buildRequest({view: 'jobs', pngBase64: 'x', effort: 'low'}).max_tokens, 3000);
});
