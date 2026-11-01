// Guards that a test or suite which starts a local server closes it even when a later step fails: an open server keeps node alive (every e2e.yml run hung 6 h on one, 21-24 Oct 2026).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const areaFolders = fs.readdirSync(here, {withFileTypes: true}).filter(item => item.isDirectory() && item.name !== 'fixtures').map(item => path.join(here, item.name));   // Why (c27, 1 Nov 2026, area folders): the tests sit in test/<area>/, so the scan walks each one
const dirs = [here, ...areaFolders, path.join(here, '..', 'suites')];
const LISTEN = /\.listen\(/;
// What can fail to start for reasons outside the test (a browser, an extension, a child process); an in-process helper on a free port cannot.
const RISKY = /\bawait\b.*(\.launch|launchPersistentContext|startRealExtension|startReplayBrowser|startExtension|spawn\(|execFile)/;
const SAFE_NEXT = /^\s*(try\s*\{|t\.after\(|after\(|return\b|\}\s*finally|\}\);?\s*$)/;

// After a line that starts a server, the next risky awaited step must sit inside a try (or a t.after cleanup was registered, or the helper returns a close handle).
export function leaks(source) {
  const lines = source.split('\n'), found = [];
  lines.forEach((line, index) => {
    if (!LISTEN.test(line) || /^\s*\/\//.test(line)) return;
    for (let next = index + 1; next < lines.length && next < index + 40; next += 1) {
      const text = lines[next];
      if (SAFE_NEXT.test(text)) break;
      if (RISKY.test(text)) { found.push(`${index + 1}: server started, then \`${text.trim().slice(0, 70)}\` runs outside a try`); break; }
    }
  });
  return found;
}

test('the guard sees a launch that sits between a listen and its try, and accepts the safe shapes', () => {
  assert.equal(leaks("await new Promise(r => s.listen(0, r));\nconst b = await chromium.launch();\ntry {\n} finally { s.close(); }").length, 1);
  assert.equal(leaks("await new Promise(r => s.listen(0, r));\nlet b;\ntry {\n  b = await chromium.launch();\n} finally { s.close(); }").length, 0);
  assert.equal(leaks("await new Promise(r => s.listen(0, r));\nt.after(() => s.close());\nawait go();").length, 0);
  assert.equal(leaks("await new Promise(r => s.listen(0, r));\nreturn {close: () => s.close()};").length, 0);
});

test('no test or suite awaits something after starting a server unless a try (or t.after) already covers it', () => {
  const bad = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter(file => /\.(mjs|js)$/.test(file) && file !== path.basename(fileURLToPath(import.meta.url)))) {
      for (const message of leaks(fs.readFileSync(path.join(dir, name), 'utf8'))) bad.push(`${path.relative(path.join(here, '..', '..'), path.join(dir, name))}:${message}`);
    }
  }
  assert.deepEqual(bad, []);
});
