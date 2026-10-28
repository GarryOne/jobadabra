// No question-mark emoji on any screen of the desktop app or the website demo (owner, 18 Oct 2026): the store's "not answered yet" marker is read only by the parsers listed here and drawn only by renderer/no-mark.js as words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {install} from './tiny-dom.js';

const MARK = String.fromCodePoint(0x2753);
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
  ? (entry.name === 'node_modules' ? [] : walk(path.join(dir, entry.name))) : [path.join(dir, entry.name)]);

// Files that READ or WRITE the marker as data (the Profile / answers text format). A new file here needs a reason; a screen never does.
const PARSERS = ['answers-model.js', 'answer-options.js', 'compensation.js', 'experience-profile-model.js', 'job-page-view.js', 'mail-report.js', 'no-mark.js',
  'preferences-model.js', 'profile-model.js', 'session-message.js', 'strategy-parts.js', 'pages/strategy-review.js',
  'work-eligibility.js'];   // #2322: reads a zone or Nationality value still asked in the Profile text, never draws it

test('only the listed parsers mention the marker; no html, css or other renderer file does', () => {
  const renderer = path.join(desktop, 'renderer');
  const seen = walk(renderer).filter(file => /\.(js|html|css)$/.test(file)).filter(file => fs.readFileSync(file, 'utf8').includes(MARK))
    .map(file => path.relative(renderer, file).split(path.sep).join('/'));
  const extra = seen.filter(file => !PARSERS.includes(file));
  assert.deepEqual(extra, [], `these renderer files draw or mention the marker; use renderer/no-mark.js: ${extra.join(', ')}`);
});

test('the website demo pages show no marker', () => {
  const site = path.join(desktop, '..');   // the site's folders sit at the top level of the joined tree
  const bad = ['web/demo', 'web/public'].flatMap(dir => fs.existsSync(path.join(site, dir)) ? walk(path.join(site, dir)) : [])
    .filter(file => /\.(html|js|css)$/.test(file) && fs.readFileSync(file, 'utf8').includes(MARK));
  assert.deepEqual(bad, []);
});

install();
globalThis.document.createTextNode ??= text => ({textContent: String(text)});   // tiny-dom has no text-node factory
const {withoutMark, withPills, hasMark, checkPill} = await import('../renderer/no-mark.js');
const {richText} = await import('../renderer/pages/rich-text.js');
const textOf = nodes => nodes.map(node => node.textContent).join('');

test('withoutMark drops the marker and keeps the words', () => {
  assert.equal(withoutMark(`${MARK} **Degree result**: none on file.`), '**Degree result**: none on file.');
  assert.equal(withoutMark(`Target: ${MARK}`), 'Target:');
  assert.ok(hasMark(`GitHub: ${MARK}`) && !hasMark('GitHub: x'));
});

test('withPills puts the "Not answered yet" pill where the marker was', () => {
  const nodes = withPills(`Target: ${MARK}`);
  assert.ok(!textOf(nodes.map(node => (typeof node === 'string' ? {textContent: node} : node))).includes(MARK));
  assert.ok(textOf(nodes.map(node => (typeof node === 'string' ? {textContent: node} : node))).includes('Not answered yet'));
});

test('Claude messages draw no marker, in a paragraph or a list', () => {
  const blocks = richText(`Left for you:\n- ${MARK} **Bachelor's degree result**: no grade is on file.\n${MARK} Any relatives at Acme?`);
  assert.ok(!textOf(blocks).includes(MARK));
  assert.ok(textOf(blocks).includes("Bachelor's degree result"));
});

test('the "Check this" pill is a warn pill with words', () => {
  const node = checkPill();
  assert.equal(node.textContent, 'Check this');
  assert.ok(node.className.includes('tone-warn'));
});
