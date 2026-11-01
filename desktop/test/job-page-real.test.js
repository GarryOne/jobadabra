// Jobs → a job's page, on sections shaped like the real ones: made by the engine's own writers (test/fixtures/job_sections.py) and the Notion
// adapter's codec, then read by renderer/job-page-view.js. A writer's format change fails here (parity checklist A+, real-page scan 2-7).
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {SECTIONS, jsonOf, kitParts, pageParts} from '../renderer/job-page-view.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const python = process.env.JOBADABRA_CHECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
// JOBADABRA_FOLLOW_APP=0: the writers never read the owner's app folder (they only build blocks; this keeps it so).
const run = spawnSync(python, [path.join(here, 'fixtures/job_sections.py')], {cwd: path.join(here, '../..'), encoding: 'utf8',
  env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', JOBADABRA_FOLLOW_APP: '0'}});
assert.equal(run.status, 0, run.stderr);
const sections = JSON.parse(run.stdout);
const words = group => group.lines.map(line => line.text ?? line.fold);

test('the kit: how it was made (a form read), and the answer that needs review', () => {
  const kit = kitParts(jsonOf(sections[SECTIONS.kit]), sections[SECTIONS.kit]);
  assert.match(kit.intro, /Form questions read from Greenhouse/);
  assert.deepEqual(kit.answers.map(item => [item.question, item.review]), [['Notice period', false], ['Salary expectation', true]]);
  assert.equal(kit.letter, 'Dear team,\n\nI run reliability today.');
});

test('the rejection review: verdict with confidence and stage, evidence, to-dos with their state, the best-guess footer', () => {
  const [review] = pageParts({sections}).groups.review;
  const lines = review.lines;
  assert.equal(lines[0].text, '🛠 Hard skills (medium confidence) · CV screen (no call). They asked for Go.');
  assert.deepEqual(lines.filter(line => line.strong).map(line => line.text), ['Evidence', 'What to improve next time']);
  assert.deepEqual(lines.filter(line => line.todo !== null).map(line => [line.text, line.todo]), [['Add the Go service you ran', false], ['Lead with SLOs', false]]);
  assert.match(lines.at(-1).text, /^Reviewed by .*A best guess/);
});

test('the record: the edited-from-draft mark stays on its question; the posting comes from its job snapshot when none is saved', () => {
  const parts = pageParts({sections});
  const answers = parts.groups.record.find(group => group.title === '🧾 Questions and answers');
  assert.deepEqual(answers.lines.filter(line => line.strong).map(line => line.text), ['Notice period ✏️ edited from draft', 'City']);
  assert.ok(!parts.groups.record.some(group => /Machine-readable/.test(group.title)));
  assert.deepEqual(parts.groups.description.flatMap(words), ['Run the platform.']);
});

test('the prep kit: its header line and every section, in order', () => {
  const prep = pageParts({sections}).groups.prep;
  assert.deepEqual(prep.map(group => group.title), ['', 'What they will likely assess', 'Likely questions', 'Stories to have ready',
    'Gaps and how to handle them', 'Ask them', 'Still unknown: ask the recruiter', 'Your prep plan']);
  assert.match(prep[0].lines[0].text, /^Technical · built 10 Oct 2026/);
  assert.deepEqual(words(prep.at(-1)), ['30 min: the DNS story', '20 min: Go basics']);
});

test('messages: the recruiter\'s message with its Full message folded, a logged entry under its own dated heading', () => {
  const messages = pageParts({sections}).groups.messages;
  const recruiter = messages.find(group => group.title === SECTIONS.recruiter);
  const full = recruiter.lines.find(line => line.fold !== undefined);
  assert.equal(full.fold, '📧 Full message');
  assert.ok(full.lines.some(line => /meet\.example\.com/.test(line.text)));
  // A logged entry is '### 📥 <day> · <summary>' in base.LOGGED on every store (src/stores append_entry): a group of its own, its quotes.
  const logged = messages.find(group => /^📥 03 Oct 2026/.test(group.title || ''));
  assert.deepEqual(logged.lines.map(line => [line.text, line.quote]), [['Hi Alex,', true], ['Could we talk on Tuesday at 10:00?', true]]);
});

test('every tab the real shapes give', () => {
  const parts = pageParts({sections, kit: jsonOf(sections[SECTIONS.kit])});
  assert.deepEqual(parts.tabs.map(([key]) => key), ['overview', 'match', 'description', 'application', 'documents', 'interviews', 'review', 'messages', 'timeline']);
  // The real shapes give content for these (kit, prep and record are all under Application now; the kit's letter under Documents); Match, Interviews and Timeline have none here.
  assert.deepEqual(Object.keys(parts.has).filter(key => parts.has[key]).sort(), ['application', 'description', 'documents', 'messages', 'review']);
});
