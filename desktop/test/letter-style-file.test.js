// The cover letter style lives beside the letter (owner, 28 Oct 2026: "everything about the cover letter should be only in Cover Letter tab"; "Beside the
// letter"): cover-letter/style.json (lib/letter-style.js). A "Cover letter style" section on the answers page (an older install, the Strategy draft, the
// line organizer) moves into the file on the next read and leaves the page; letter writers get the rules as that same section of the answers text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as letterStyle from '../lib/letter-style.js';

const fresh = () => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-style-')), {encrypt: v => v, decrypt: v => v}); s.saveSettings({store: 'sqlite', telemetry: false}); return s; };
const answers = s => store.openStore(s).page('answers');

test('an old Cover letter style section moves into cover-letter/style.json once and leaves the answers page; the other answers stay', async () => {
  const s = fresh();
  await answers(s).write('## Common questions\n- Notice period: 3 months\n\n## Cover letter style\n- Length: 130–170 words\n- Never mention: salary\n');
  assert.deepEqual(await letterStyle.read(s), ['Length: 130–170 words', 'Never mention: salary']);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.path('cover-letter/style.json'), 'utf8')).lines, ['Length: 130–170 words', 'Never mention: salary']);
  const page = await answers(s).text();
  assert.doesNotMatch(page, /Cover letter style|Never mention/);
  assert.match(page, /Notice period: 3 months/);
  assert.deepEqual(await letterStyle.read(s), ['Length: 130–170 words', 'Never mention: salary'], 'a second read changes nothing');
});

test('a section written again later (the Strategy draft, the organizer) joins the file without a duplicate', async () => {
  const s = fresh();
  await letterStyle.save(s, ['Length: short']);
  await answers(s).write('## Cover letter style\n- Length: short\n- Tone: warm\n');
  assert.deepEqual(await letterStyle.read(s), ['Length: short', 'Tone: warm']);
  assert.doesNotMatch(await answers(s).text(), /Cover letter style/);
});

test('saving replaces the rules; an empty line is dropped; no file and no section reads as no rules', async () => {
  const s = fresh();
  assert.deepEqual(await letterStyle.read(s), []);
  await letterStyle.save(s, ['Tone: direct', '  ', 'Never mention: salary']);
  assert.deepEqual(await letterStyle.read(s), ['Tone: direct', 'Never mention: salary']);
  await letterStyle.save(s, ['Tone: direct']);
  assert.deepEqual(await letterStyle.read(s), ['Tone: direct']);
});

// Gitar on #2328: the editor saves what it was opened on plus the edit; a rule moved into the file meanwhile (a letter's read of a section the Strategy
// draft or the organizer wrote) is kept, never written over by the editor's older copy.
test('saving an edit keeps a rule moved into the file while the editor was open; an edited or removed rule leaves', async () => {
  const s = fresh();
  const was = letterStyle.save(s, ['Length: short', 'Tone: warm']);
  await answers(s).write('## Cover letter style\n- Never mention: salary\n');
  await letterStyle.read(s);   // a letter is written meanwhile: the new rule moves into the file
  assert.deepEqual(await letterStyle.saveEdit(s, ['Length: 130–170 words'], was), ['Length: 130–170 words', 'Never mention: salary']);
  assert.deepEqual(await letterStyle.read(s), ['Length: 130–170 words', 'Never mention: salary']);
  assert.deepEqual(await letterStyle.saveEdit(s, ['Length: 130–170 words'], ['Length: 130–170 words', 'Never mention: salary']), ['Length: 130–170 words'], 'a rule the editor showed and removed leaves');
});

test('letter writers get the rules as the Cover letter style section of the answers text they already read', () => {
  assert.equal(letterStyle.withStyle('- Notice period: 3 months', ['Tone: direct']), '- Notice period: 3 months\n\n## Cover letter style\n- Tone: direct');
  assert.equal(letterStyle.withStyle('- Notice period: 3 months', []), '- Notice period: 3 months');
  assert.equal(letterStyle.withStyle('- Notice period: 3 months\n\n## ✍️ Cover letter style\n- Tone: old\n\n## Other\n- Pets: none', ['Tone: direct']),
    '- Notice period: 3 months\n\n## Other\n- Pets: none\n\n## Cover letter style\n- Tone: direct', 'an old copy in the text is replaced, never doubled');
});

test('in demo mode the rules are read from the demo folder and nothing in it is moved or written', async () => {
  const s = fresh();
  s.writeText('answers.md', '## Cover letter style\n- Tone: direct\n');
  assert.deepEqual(await letterStyle.read(s, {demo: true}), ['Tone: direct']);
  assert.match(s.readText('answers.md'), /Cover letter style/);
  assert.equal(fs.existsSync(s.path('cover-letter/style.json')), false);
});

test('the engine gets the file\'s path, so a kit letter follows the same rules', async () => {
  const {pipelineEnv} = await import('../lib/pipeline-env.js');
  const s = fresh();
  assert.equal(pipelineEnv(s).JOB_PILOTTO_LETTER_STYLE_FILE, s.path('cover-letter/style.json'));
});
