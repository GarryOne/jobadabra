// lib/match-check.js: the CV as text, the answer's shape and limits, and the kept answer per job.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {check, cvText, guard, save, saved} from '../lib/match-check.js';

const cv = {summary: 'Platform engineer **eight** years.', skills: 'Kubernetes, Terraform', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2020 – Present', place: 'Zurich', bullets: ['Ran the on-call rota', 'Moved 40 services to Kubernetes'], skills: 'AWS'}]}]};
const job = {title: 'Platform Engineer', company: 'Beta', location: 'London', description: 'You will run Kubernetes and Prometheus. Must have the right to work in the UK. Three days a week in the office.'};

test('the CV is given to the model as plain text, bullets and skills included', () => {
  const text = cvText(cv);
  assert.match(text, /SRE · Acme · 2020 – Present · Zurich/);
  assert.match(text, /- Moved 40 services to Kubernetes/);
  assert.doesNotMatch(text, /\*\*/);
});

test('the answer is trimmed to its limits and priced; the posting and the CV both go to the model', async () => {
  const fake = {messages: {create: async request => {
    assert.match(request.messages[0].content, /<cv>[\s\S]*Kubernetes[\s\S]*<posting>[\s\S]*Prometheus/);
    return {stop_reason: 'end_turn', usage: {input_tokens: 3000, output_tokens: 700}, content: [{type: 'text', text: JSON.stringify({
      grade: 'B', summary: 'Most of it is stated.', advice: ['a', 'b', 'c', 'd', 'e', 'f'],
      musts: Array.from({length: 13}, (_, i) => ({term: `t${i}`, status: i ? 'missing' : 'found', evidence: ''})),
      knockouts: Array.from({length: 11}, (_, i) => ({requirement: `r${i}`, status: 'check', note: 'confirm it'}))})}]};
  }}};
  const result = await check({}, '', {job, cv, client: fake});
  assert.equal(result.grade, 'B');
  assert.equal(result.musts.length, 10);
  assert.equal(result.knockouts.length, 8);
  assert.equal(result.advice.length, 4);
  assert.equal(result.usd, 0.01);
});

test('the last answer for a job is kept, and said to be old once the CV changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-'));
  const storage = {path: (...parts) => path.join(dir, ...parts)};
  assert.equal(saved(storage, 'ab12cd34', cv), null);
  save(storage, 'ab12cd34', cv, job, {grade: 'C'});
  assert.equal(saved(storage, 'ab12cd34', cv).result.grade, 'C');
  assert.equal(saved(storage, 'ab12cd34', cv).stale, undefined);
  assert.equal(saved(storage, 'ab12cd34', {...cv, summary: 'Changed'}).stale, true);
  assert.equal(saved(storage, '../../etc/passwd', cv), null, 'a code is a file name, nothing more');
});

test('a claim the CV does not bear out is corrected before it is shown', () => {
  const text = cvText(cv);   // states Kubernetes, Terraform, AWS, on-call; never Prometheus or SLOs
  const musts = [
    {term: 'Kubernetes', status: 'found', evidence: 'Moved 40 services to Kubernetes'},   // true, stays
    {term: 'Prometheus', status: 'found', evidence: 'Built alerting with Prometheus'},       // not in the CV: only implied
    {term: 'Terraform', status: 'missing', evidence: ''},                                     // it is in the CV: found
    {term: 'AWS', status: 'implied', evidence: ''},                                           // stated in a skills line: found
    {term: 'SLOs', status: 'missing', evidence: ''}];                                         // really missing, stays
  const out = guard({musts, knockouts: [{requirement: 'x', status: 'conflict', note: 'n'}]}, text);
  assert.deepEqual(out.musts.map(item => `${item.term}:${item.status}`), ['Kubernetes:found', 'Prometheus:implied', 'Terraform:found', 'AWS:found', 'SLOs:missing']);
  assert.equal(out.knockouts[0].status, 'conflict', 'a judgement is left as the model gave it');
  assert.equal(out.corrected, 3);
});

test('a term only the Experience bank has is "bank", not implied or missing; the CV still wins', () => {
  const musts = [{term: 'Prometheus', status: 'missing', evidence: ''}, {term: 'Kubernetes', status: 'implied', evidence: ''}, {term: 'Go', status: 'implied', evidence: ''}];
  const out = guard({musts}, cvText(cv), '["Prometheus alerts for the on-call rota"]').musts;
  assert.deepEqual(out.map(item => item.status), ['bank', 'found', 'implied']);
  assert.equal(out[0].evidence, 'In your Experience bank');
  assert.deepEqual(guard({musts: [musts[0]]}, cvText(cv)).musts[0].status, 'missing', 'no bank, no change');
});
