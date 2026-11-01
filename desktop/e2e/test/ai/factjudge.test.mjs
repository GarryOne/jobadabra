// The judge's request builder and verdict parser, with fake responses (no network).
import assert from 'node:assert/strict';
import test from 'node:test';
import {JUDGE_MODEL, buildRequest, failures, judge, parseVerdict} from '../../lib/factjudge.mjs';

const posting = {title: 'Senior SRE', location: 'Zurich', description: 'Kubernetes, hybrid in Zurich.'};
const good = {grounded: true, contradicts_posting: false, invents_facts: false, useful: true, why: 'Every claim is in the posting.'};

test('the request names the posting, the candidate and the text, uses Sonnet and has no temperature', () => {
  const request = buildRequest({posting, profile: 'Alex, 9 years SRE', produced: ['Kubernetes match', null, 'Gaps: no Go']});
  assert.equal(request.model, JUDGE_MODEL);
  assert.ok(!('temperature' in request));
  const text = request.messages[0].content;
  for (const part of ['Senior SRE', 'Zurich', 'Kubernetes, hybrid in Zurich.', 'Alex, 9 years SRE', 'Kubernetes match\nGaps: no Go']) assert.ok(text.includes(part), part);
  assert.ok(!text.includes('null'));
  assert.match(request.system, /invents_facts/);
});

test('a strict verdict parses, also inside a code fence or with chatter around it', () => {
  assert.deepEqual(parseVerdict(JSON.stringify(good)), good);
  assert.deepEqual(parseVerdict('```json\n' + JSON.stringify(good) + '\n```'), good);
  assert.equal(parseVerdict('Here you go: ' + JSON.stringify(good) + ' Done.').useful, true);
});

test('a broken verdict is an error, never a pass', () => {
  assert.throws(() => parseVerdict('looks fine to me'), /did not answer with JSON/);
  assert.throws(() => parseVerdict(''), /did not answer with JSON/);
  assert.throws(() => parseVerdict(undefined), /did not answer with JSON/);
  assert.throws(() => parseVerdict(JSON.stringify({...good, invents_facts: 'no'})), /invents_facts/);
  const {why: _why, ...noWhy} = good;
  assert.throws(() => parseVerdict(JSON.stringify(noWhy)), /why/);
  assert.throws(() => parseVerdict(JSON.stringify({...good, grounded: undefined})), /grounded/);
});

test('only invented facts and contradictions fail', () => {
  assert.deepEqual(failures(good), []);
  assert.deepEqual(failures({...good, useful: false, grounded: false}), []);
  assert.deepEqual(failures({...good, invents_facts: true}), ['invents facts']);
  assert.deepEqual(failures({...good, invents_facts: true, contradicts_posting: true}), ['invents facts', 'contradicts the posting']);
});

test('judge() sends the request with the key and parses the reply; an API error is thrown with its message', async () => {
  let seen;
  const ok = async (url, init) => { seen = {url, init}; return {ok: true, json: async () => ({content: [{type: 'text', text: JSON.stringify(good)}]})}; };
  assert.deepEqual(await judge({key: 'k', posting, profile: 'p', produced: 'x', fetchImpl: ok}), good);
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'k');
  assert.ok(!('temperature' in JSON.parse(seen.init.body)));
  const rejected = async () => ({ok: false, status: 400, json: async () => ({error: {message: 'temperature is deprecated'}})});
  await assert.rejects(judge({key: 'k', posting, profile: 'p', produced: 'x', fetchImpl: rejected}), /400.*temperature is deprecated/);
});

test('a blank reply is asked again once; a second blank reply is an error', async () => {
  let calls = 0;
  const replies = [{content: [{type: 'text', text: ''}]}, {content: [{type: 'text', text: JSON.stringify(good)}]}];
  const flaky = async () => ({ok: true, json: async () => replies[calls++]});
  assert.deepEqual(await judge({key: 'k', posting, profile: 'p', produced: 'x', fetchImpl: flaky}), good);
  assert.equal(calls, 2);
  let blank = 0;
  const always = async () => { blank++; return {ok: true, json: async () => ({content: []})}; };
  await assert.rejects(judge({key: 'k', posting, profile: 'p', produced: 'x', fetchImpl: always}), /did not answer with JSON/);
  assert.equal(blank, 2);
  assert.match(buildRequest({posting, profile: 'p', produced: 'x'}).system, /not stated, unknown or unspecified/);
});

test('the request carries the extracted facts the scorer saw, and skips empty ones', () => {
  const text = buildRequest({posting, profile: 'p', produced: 'x', facts: {Seniority: 'Senior', Languages: ['English', 'German +'], Salary: '', Recruiter: false, Technologies: ''}}).messages[0].content;
  assert.match(text, /EXTRACTED FACTS \(stage 1\)\nSeniority: Senior\nLanguages: English, German \+\nRecruiter: false/);
  assert.ok(!/Salary:|Technologies:/.test(text));
  assert.match(buildRequest({posting, profile: 'p', produced: 'x'}).messages[0].content, /EXTRACTED FACTS \(stage 1\)\n\(none\)/);
  assert.match(buildRequest({posting, profile: 'p', produced: 'x'}).system, /extracted facts/);
});

test('the judge is told the posting\'s company, so a score text naming the employer is not "invented" (job 3008, 3 Oct 2026)', async () => {
  const {buildRequest} = await import('../../lib/factjudge.mjs');
  const posting = {title: 'Senior Platform Engineer', company: 'E2E Quality Labs', location: 'Geneva', description: 'Kubernetes.'};
  assert.match(buildRequest({posting, profile: 'p', produced: ['x']}).messages[0].content, /Title: Senior Platform Engineer\nCompany: E2E Quality Labs\nLocation: Geneva/);
  assert.doesNotMatch(buildRequest({posting: {...posting, company: ''}, profile: 'p', produced: ['x']}).messages[0].content, /Company:/);
});
