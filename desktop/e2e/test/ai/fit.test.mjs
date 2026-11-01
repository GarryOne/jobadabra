// The persona-fit judge's own checks (lib/fit.mjs): everything but the model call is plain code, tested here against deliberately wrong replies.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRequest, judge, parseIssues, SYSTEM, toFindings} from '../../lib/fit.mjs';

const pages = [{view: 'jobs', text: 'Jobs\nUse the posting\'s own words for skills you really have: "Kubernetes", not "k8s".\nEditorial Photographer, Basel'}, {view: 'focus', text: 'Apply to 5 more jobs today'}];

test('the request holds the candidate and each page, and the instructions name no profession or word list', () => {
  const request = buildRequest({candidate: 'a nurse in Manchester', pages});
  const sent = request.messages[0].content;
  assert.match(sent, /a nurse in Manchester/);
  assert.match(sent, /=== jobs ===/);
  assert.match(sent, /=== focus ===/);
  assert.equal(request.temperature, undefined);
  for (const word of ['Kubernetes', 'IT ', 'DevOps', 'software', 'engineer', 'nurse', 'photographer']) assert.ok(!SYSTEM.includes(word), `the system prompt names "${word}": the Finder holds no profession`);
});

test('an issue is kept only when its quote is on a page, with that page named; a made-up quote is dropped and counted', () => {
  const reply = JSON.stringify({issues: [
    {quote: 'Use the posting\'s own words for skills you really have: "Kubernetes", not "k8s".', assumes: 'IT candidates', why: 'a nurse does not write Kubernetes'},
    {quote: 'Rotate your on-call shifts', assumes: 'IT candidates', why: 'invented by the model'},
    {quote: '', assumes: 'x', why: 'empty'}, {assumes: 'no quote'}, null]});
  const {issues, unverified, unreadable} = parseIssues(reply, pages);
  assert.equal(unreadable, false);
  assert.equal(unverified, 1);
  assert.deepEqual(issues.map(item => [item.view, item.assumes]), [['jobs', 'IT candidates']]);
  const [finding] = toFindings(issues);
  assert.deepEqual([finding.view, finding.severity, finding.kind], ['jobs', 'warning', 'audience-mismatch']);
  assert.match(finding.detail, /written for IT candidates/);
});

test('whitespace and case do not hide a real quote', () => {
  const {issues} = parseIssues(JSON.stringify({issues: [{quote: 'APPLY TO  5 more\njobs today', assumes: 'x', why: 'y'}]}), pages);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].view, 'focus');
});

test('a reply that cannot be read is flagged unreadable, never a pass', () => {
  for (const bad of ['', 'I think everything is fine.', '{"issues": "none"}', '{"nothing": []}']) assert.equal(parseIssues(bad, pages).unreadable, true, bad);
  assert.deepEqual(parseIssues('{"issues": []}', pages), {issues: [], unverified: 0, unreadable: false});
});

test('judge sends one request with the key and returns what was found; a refused request throws', async () => {
  const seen = [];
  const ok = async (url, options) => { seen.push({url, key: options.headers['x-api-key'], body: JSON.parse(options.body)}); return {ok: true, json: async () => ({content: [{type: 'text', text: JSON.stringify({issues: [{quote: 'Apply to 5 more jobs today', assumes: 'x', why: 'y'}]})}]})}; };
  const result = await judge({key: 'k', candidate: 'c', pages, fetchImpl: ok});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].key, 'k');
  assert.equal(result.issues.length, 1);
  await assert.rejects(judge({key: 'k', candidate: 'c', pages, fetchImpl: async () => ({ok: false, status: 401, json: async () => ({error: {message: 'bad key'}})})}), /401.*bad key/);
});
