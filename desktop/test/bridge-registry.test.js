// Bridge registry (Notion optional): a temporary cross-lane shim is marked `# BRIDGE(<lane>): remove when <what> lands` (Python) or
// `// BRIDGE(...)` (JS). This lists every one in src/ and desktop/ and fails when the store choice ships on (STORE_CHOICE in
// desktop/lib/store-handlers.js, its value with no environment) while any remain. A malformed marker always fails.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'shared', 'dist', 'out', '.git', '__pycache__']);
const SELF = path.join(REPO, 'desktop/test/bridge-registry.test.js');

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full);
    return /\.(py|js|mjs|cjs)$/.test(entry.name) && full !== SELF ? [full] : [];
  });
}

export function bridgeMarkers(text, file) {
  const markers = [];
  text.split('\n').forEach((line, index) => {
    if (!/BRIDGE\(/.test(line)) return;
    const marker = /(?:#|\/\/)\s*BRIDGE\(([^)]+)\):\s*remove when (\S.*)$/.exec(line);
    markers.push(marker ? {at: `${file}:${index + 1}`, lane: marker[1].trim(), when: marker[2].trim()} : {at: `${file}:${index + 1}`, malformed: line.trim()});
  });
  return markers;
}

const allMarkers = () => ['src', 'desktop'].flatMap(top => walk(path.join(REPO, top)))
  .flatMap(full => bridgeMarkers(fs.readFileSync(full, 'utf8'), path.relative(REPO, full)));

// The default the app ships with: the STORE_CHOICE line of store-handlers.js evaluated with no environment (no import: the module pulls the
// whole app). If the line is rewritten so it cannot be found, this fails and asks for the reader to follow it.
export function storeChoiceShipsOn(source = fs.readFileSync(path.join(REPO, 'desktop/lib/store-handlers.js'), 'utf8')) {
  const line = /^export const STORE_CHOICE = (.+);$/m.exec(source);
  assert.ok(line, 'STORE_CHOICE is no longer `export const STORE_CHOICE = <expression>;` in desktop/lib/store-handlers.js: update bridge-registry.test.js');
  return new Function('process', `return (${line[1]});`)({env: {}}) === true;
}

test('the bridge markers are listed, well formed, and none remain once the store choice ships on', () => {
  const markers = allMarkers();
  console.log(`Bridges: ${markers.length}${markers.map(m => `\n  ${m.at} ${m.lane ? `(${m.lane}) remove when ${m.when}` : `MALFORMED: ${m.malformed}`}`).join('')}`);
  const malformed = markers.filter(m => m.malformed).map(m => m.at);
  assert.deepEqual(malformed, [], 'a BRIDGE marker must read `# BRIDGE(<lane>): remove when <what> lands`');
  if (storeChoiceShipsOn()) assert.deepEqual(markers.map(m => m.at), [], 'STORE_CHOICE ships on: remove every bridge first');
});

test('the marker reader takes both comment styles and flags a malformed one', () => {
  const text = "x = 1  # BRIDGE(F): remove when insights land\n// BRIDGE(mac-27): remove when P8 C lands\n// BRIDGE(x) later";
  assert.deepEqual(bridgeMarkers(text, 'f'), [
    {at: 'f:1', lane: 'F', when: 'insights land'}, {at: 'f:2', lane: 'mac-27', when: 'P8 C lands'}, {at: 'f:3', malformed: '// BRIDGE(x) later'}]);
});

test('the shipped STORE_CHOICE is read from the code with no environment', () => {
  assert.equal(storeChoiceShipsOn("export const STORE_CHOICE = process.env.JOBADABRA_STORE_CHOICE === '1';"), false);
  assert.equal(storeChoiceShipsOn("export const STORE_CHOICE = process.env.JOBADABRA_STORE_CHOICE !== '0';"), true);
  assert.equal(storeChoiceShipsOn('export const STORE_CHOICE = true;'), true);
  assert.equal(storeChoiceShipsOn(), true, 'the choice ships on (the flip): every bridge must be gone');
});
