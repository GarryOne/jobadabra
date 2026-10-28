import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as letters from '../lib/cover-letter.js';
import {me} from '../lib/server.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-letter-')), fakeCrypto);
const CV = {name: 'Ada Example', location: 'Zurich', summary: 'SRE.', jobs: [{company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Cut costs by **50%**.']}]}]};
const withCv = storage => { fs.mkdirSync(path.join(storage.path('cv')), {recursive: true}); fs.writeFileSync(storage.path('cv/cv.json'), JSON.stringify(CV)); return storage; };
const client = (letter, seen = []) => ({messages: {create: async request => { seen.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 1000, output_tokens: 300},
  content: [{type: 'text', text: JSON.stringify({letter})}]}; }}});

test('a generated letter is a draft, built from the CV and the About you bundle', async () => {
  const storage = withCv(tempStorage()), seen = [];
  const result = await letters.generate(storage, {client: client('Dear Hiring Team,\n\nI cut costs by 50%.', seen),
    about: {parts: {strategy: [{label: 'Roles', value: 'Prefers remote SRE roles'}], voice: {preferences: ['Direct voice']}}, lacked: []}});
  assert.match(result.text, /50%/);
  assert.deepEqual([letters.status(storage).state, letters.status(storage).pdf], ['draft', false]);
  const prompt = seen[0].messages[0].content;
  assert.match(prompt, /Cut costs/);
  assert.match(prompt, /Prefers remote SRE roles/);
  assert.match(prompt, /Direct voice/);
});

test('no CV data yet: generating says what to do first', async () => {
  await assert.rejects(letters.generate(tempStorage(), {client: client('x')}), /Read your CV first/);
});

test('approving keeps the PDF; editing the text makes it a draft again and drops the PDF', async () => {
  const storage = withCv(tempStorage());
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nHello.')});
  letters.approve(storage, Buffer.from('%PDF-letter'));
  assert.equal(letters.status(storage).state, 'approved');
  assert.equal(letters.status(storage).pdf, true);
  letters.edit(storage, 'Dear Hiring Team,\n\nHello.');  // unchanged text stays approved
  assert.equal(letters.status(storage).state, 'approved');
  letters.edit(storage, 'Dear Hiring Team,\n\nHello, changed.');
  assert.deepEqual([letters.status(storage).state, letters.status(storage).pdf], ['draft', false]);
  assert.throws(() => letters.edit(storage, '   '), /empty/);
});

test('the PDF page escapes the text and shows the sender', () => {
  const page = letters.html('Dear Team,\n\nI <3 uptime & more.', {first_name: 'Ada', last_name: 'Example', email: 'ada@example.test'});
  assert.match(page, /<h1>Ada Example<\/h1>/);
  assert.match(page, /ada@example\.test/);
  assert.match(page, /I &lt;3 uptime &amp; more\./);
  assert.equal((page.match(/<p>/g) || []).length, 2);
});

test('the extension gets a base letter only after approval; approval creates its usable PDF', async () => {
  const storage = withCv(tempStorage());
  storage.saveSettings({letterFallback: false});  // a legacy opt-out no longer blocks the automatic default
  assert.equal((await me(storage)).coverLetterFile, null);
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nHello.')});
  assert.equal((await me(storage)).coverLetterFile, null);  // an unapproved draft is never used
  letters.approve(storage, Buffer.from('%PDF-letter'));
  const file = (await me(storage)).coverLetterFile;
  assert.equal(file.type, 'application/pdf');
  assert.equal(Buffer.from(file.data, 'base64').toString(), '%PDF-letter');
  assert.equal(storage.settings().letterFallback, false, 'legacy settings are normalized without a user-data write');
});

test('a base letter with a gap left to fill cannot be approved', async () => {
  const storage = withCv(tempStorage());
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nI would love to join [Company].')});
  assert.throws(() => letters.approve(storage, Buffer.from('%PDF-letter')), /\[Company\]/);
  assert.equal(letters.status(storage).state, 'draft');
});

// Who pays for a draft, said before and after it runs (owner, 18 Oct 2026): app credits, the person's API account, or their plan; never an invented $0.
test('a draft records who paid and its real cost; status returns both', async () => {
  assert.equal(letters.paidByOf({key: 'JPF1.install.token'}), 'credits');
  assert.equal(letters.paidByOf({key: 'JP1.founder'}), 'credits');
  assert.equal(letters.paidByOf({key: 'sk-ant-own'}), 'api');
  assert.equal(letters.paidByOf({key: 'sk-ant-own', client: {billing: 'subscription'}}), 'plan');
  assert.equal(letters.paidByOf({client: {billing: 'api'}}), 'api');
  assert.equal(letters.paidByOf({}), '');
  const storage = withCv(tempStorage());
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nHello.'), paidBy: 'api'});
  const status = letters.status(storage);
  assert.equal(status.paidBy, 'api');
  assert.ok(status.usd > 0, 'tokens priced on an API account');
  letters.edit(storage, 'Dear Hiring Team,\n\nMine.');
  assert.equal(letters.status(storage).paidBy, 'api', 'the last draft is still the last draft after an edit');
});

test('one availability decision delivers approved base text and PDF, or an actionable setup gap', async () => {
  const storage = withCv(tempStorage());
  const missing = await me(storage);
  assert.equal(missing.coverLetterStatus?.state, 'missing');
  assert.match(missing.coverLetterStatus?.action || '', /Create/);
  await letters.generate(storage, {client: client('Dear Hiring Team,\n\nHello.')});
  assert.equal((await me(storage)).coverLetterStatus?.state, 'draft');
  letters.approve(storage, Buffer.from('%PDF-letter'));
  assert.equal((await me(storage)).coverLetterStatus?.state, 'ready');
  const {letterQuestion} = await import('../lib/letter-availability.js');
  assert.equal(letterQuestion(storage), null, 'usable approved fallback removes the derived queue item');
  const ready = await me(storage);
  assert.equal(ready.coverLetterStatus?.state, 'ready');
  assert.equal(ready.coverLetterText, letters.status(storage).text);
  assert.ok(ready.coverLetterFile);
  fs.rmSync(letters.pdfPath(storage));
  assert.equal((await me(storage)).coverLetterStatus?.state, 'unavailable');
});


test('failed generation never clears missing setup or approves a draft', async () => {
  const storage = withCv(tempStorage());
  await assert.rejects(letters.generate(storage, {client: {messages: {create: async () => { throw new Error('fictional generation failure'); }}}}), /fictional generation failure/);
  assert.equal((await me(storage)).coverLetterStatus.state, 'missing');
  assert.equal(letters.status(storage).state, 'none');
});

test('a failed redraft leaves the last approved letter and its PDF intact', async () => {
  const storage = withCv(tempStorage());
  await letters.generate(storage, {client: client('Approved original')});
  letters.approve(storage, Buffer.from('%PDF-approved-original'));
  await assert.rejects(letters.generate(storage, {client: {messages: {create: async () => { throw new Error('fictional redraft failure'); }}}}), /fictional redraft failure/);
  assert.equal(letters.status(storage).text, 'Approved original');
  assert.equal(letters.status(storage).state, 'approved');
  assert.equal(letters.status(storage).pdf, true);
  assert.equal(fs.readFileSync(letters.pdfPath(storage), 'utf8'), '%PDF-approved-original');
});

test('a successful redraft becomes an unapproved draft and cannot reuse the prior PDF', async () => {
  const storage = withCv(tempStorage());
  await letters.generate(storage, {client: client('Approved original')});
  letters.approve(storage, Buffer.from('%PDF-approved-original'));
  await letters.generate(storage, {client: client('Fictional replacement draft')});
  assert.equal(letters.status(storage).text, 'Fictional replacement draft');
  assert.equal(letters.status(storage).state, 'draft');
  assert.equal(letters.status(storage).pdf, false);
  assert.equal(fs.existsSync(letters.pdfPath(storage)), false);
});
