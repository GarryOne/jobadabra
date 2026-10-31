// LinkedIn jobs, PR 1/3: the four doors (Settings row, ask on Find jobs, Suggestions entry, ⌘K) open ONE consent, and the words the owner approved on 31 Oct 2026 are in it.
// Pure parts: renderer/linkedin-words.js; the doors are checked by what each source file imports (one loop).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {CONSENT, KEY, LINE, askOnPress, linkedinEntries} from '../renderer/linkedin-words.js';
import {LOOK} from '../renderer/suggestions.js';

const off = {loaded: true, on: false, asked: 0, declined: 0, ask: true, hasSession: false};

test('the Suggestions entry: one row while off, with the one-click action and Not now, gone when on, answered or not read yet', () => {
  const [entry, ...rest] = linkedinEntries({view: off});
  assert.equal(rest.length, 0);
  assert.equal(entry.kind, 'linkedin');
  assert.equal(entry.key, KEY);
  assert.deepEqual(entry.actions, [{label: 'Turn on LinkedIn', do: 'turn_on_linkedin'}]);
  assert.deepEqual(entry.answers, ['Not now']);
  assert.equal(entry.home, 'focus');
  assert.deepEqual(linkedinEntries({view: {...off, on: true}}), [], 'on: no entry');
  assert.deepEqual(linkedinEntries({view: {...off, loaded: false}}), [], 'state not read yet: no flash of an offer');
  assert.deepEqual(linkedinEntries({view: off, hidden: new Set([KEY])}), [], 'answered Not now in an earlier read');
  assert.deepEqual(linkedinEntries({view: off, held: new Set([KEY])}), [], 'answered here, not yet saved');
  assert.deepEqual(linkedinEntries({}), []);
  assert.ok(LOOK.linkedin && LOOK.linkedin.icon === 'linkedin', 'the row has its look (icon, edge colour, badge)');
});

test('the ask is for a real Find jobs press while it is due, not for a re-score or Find employers', () => {
  assert.equal(askOnPress({ask: true}, undefined), true);
  assert.equal(askOnPress({ask: true}, {}), true);
  assert.equal(askOnPress({ask: false}, undefined), false);
  assert.equal(askOnPress({ask: true}, {reason: 'rescore', count: 3}), false);
  assert.equal(askOnPress({ask: true}, {employers: true}), false);
  assert.equal(askOnPress(null, undefined), false);
});

test('the consent words: the owner\'s warning line verbatim, what is read, where it stays, and how to turn it off', () => {
  assert.equal(LINE, 'LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches.');
  for (const mode of ['ask', 'turn-on']) {
    const words = CONSENT[mode];
    assert.equal(words.line, LINE);
    assert.match(words.lead, /background/);
    assert.match(words.lead, /sign-in from Chrome/);
    assert.match(words.lead, /on this Mac/);
    assert.match(words.lead, /Settings → Connections → LinkedIn/);
    assert.equal(words.yes, 'Turn on LinkedIn');
    assert.equal(words.no, 'Not now');
  }
  assert.equal(CONSENT.manage.yes, 'Turn off');
  assert.equal(CONSENT.manage.no, 'Keep on');
});

test('every door opens the one consent: Settings row, ask on Find jobs, Suggestions entry, ⌘K', () => {
  // nav.js (⌘K) takes the command from the same module: linkedinCommand() opens the consent (kept out of nav.js's long function: clean-code complexity)
  const doors = {'renderer/pages/settings.js': 'openLinkedinConsent', 'renderer/pages/jobs.js': 'askLinkedinOnPress', 'renderer/pages/focus-suggestions.js': 'openLinkedinConsent', 'renderer/pages/nav.js': 'linkedinCommand'};
  for (const [file, name] of Object.entries(doors)) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '[./]*(pages/)?linkedin-consent\\.js'`), `${file} imports ${name} from the one consent module`);
  }
});

test('the consent dialog exists once in the page and uses the shared dialog look', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/id="linkedin-dialog"/g)?.length, 1);
  assert.match(html, /<dialog id="linkedin-dialog" class="save-dialog panel-dialog">/);
});
