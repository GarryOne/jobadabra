// "Apply with Claude" is gone from every screen while SHOW_RESUME_CLAUDE is off (owner, 24 Oct 2026: "we don't have anymore Apply with X functionality").
// The class: every renderer line that draws it asks resumeOffered(), no visible text names it, and the Optional extras card starts hidden.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const walk = dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const NAMED = /Apply with Claude/;

test('renderer scripts: a line that names Apply with Claude is a comment or asks resumeOffered', () => {
  const found = [];
  for (const file of walk('renderer').filter(name => name.endsWith('.js'))) {
    read(file).split('\n').forEach((line, index) => {
      if (!NAMED.test(line) || /^\s*(\/\/|\/\*|\*)/.test(line)) return;
      found.push(`${file.replaceAll('\\', '/')}:${index + 1}`);   // Windows CI: compare paths with /
    });
  }
  assert.deepEqual(found.filter(spot => !spot.startsWith('renderer/pages/jobs-render.js')), [], 'visible text names Apply with Claude');
  // the one menu entry is built only inside the flag
  const render = read('renderer/pages/jobs-render.js');
  assert.match(render, /if \(jobsState\.claudeReady && resumeOffered\(\)\) \{[^]*'Apply with Claude'/);
});

test('index.html: no visible text offers Apply with Claude; the batch modal has no independent mode radio', () => {
  const html = read('renderer/index.html');
  assert.doesNotMatch(html.replace(/<[^>]*id="claude-extra"[^]*?<\/div>\s*(?=<)/g, ''), NAMED);
  assert.match(html, /id="claude-extra" hidden/);
  assert.doesNotMatch(html, /name="apply-mode"/);
});

test('class: the card and Settings checklist follow the takeover flag; the batch modal has no second mode selector', () => {
  const prereqs = read('renderer/pages/claude-prereqs.js');
  assert.match(prereqs, /card\.hidden = !resumeOffered\(\)/);
  assert.match(prereqs, /inSettings\.hidden = !resumeOffered\(\)/);
  assert.doesNotMatch(read('renderer/pages/jobs.js'), /resumeOffered|name="apply-mode"/);
});

test('main process: a notification never falls back to the name Apply with Claude', () => {
  assert.doesNotMatch(read('lib/server.js'), /\|\| 'Apply with Claude'/);
});

test('class: every main-process path that starts Apply with Claude refuses while the flag is off', () => {
  assert.match(read('main.js'), /const startClaude = async \(url, details = null\) => !claudeFamily\(storage\) \?[^]*\n  : !SHOW_RESUME_CLAUDE \?/);   // the applyWithClaude IPC and the take-over
  assert.match(read('lib/apply-handlers.js'), /if \(agents && !SHOW_RESUME_CLAUDE\) return/);   // any legacy IPC caller's agents mode remains guarded
  assert.match(read('lib/session-handlers.js'), /if \(how === 'claude' && !SHOW_RESUME_CLAUDE\) return/);   // Start again with Claude
  for (const file of walk('lib').filter(name => name.endsWith('.js'))) {   // nothing else calls the launcher: a new caller must be added here, gated
    if (/claudeOne\(|apply\.start\(/.test(read(file)) && !/apply-handlers|session-handlers|apply\.js|claude-session/.test(file)) assert.fail(`${file} starts Claude without the flag gate`);
  }
});

test('extension UI: no panel or popup string offers Apply with Claude', () => {
  const extension = path.resolve(root, '..', 'extension');
  for (const name of fs.readdirSync(extension).filter(n => /\.(js|html)$/.test(n))) {
    fs.readFileSync(path.join(extension, name), 'utf8').split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      assert.doesNotMatch(line.replace(/\s\/\/.*$/, ''), NAMED, `${name}:${index + 1}`);   // a trailing comment is not a string
    });
  }
  assert.match(fs.readFileSync(path.join(extension, 'panel-claude.js'), 'utf8'), /takeover/);   // its one offer is built only when the app's reply says the takeover is on
});
