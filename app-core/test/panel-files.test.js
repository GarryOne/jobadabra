// The panel is several classic scripts that share window.__jobPilottoPanel*; every place that injects review.js injects them all, before it, in the list's order (extension/panel-files.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PANEL_FILES } from '../../extension/panel-files.js';

const ROOT = new URL('../../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, ROOT), 'utf8');
const sources = (dir) => fs.readdirSync(new URL(dir, ROOT), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? (entry.name === 'node_modules' ? [] : sources(`${dir}${entry.name}/`)) : /\.(js|mjs)$/.test(entry.name) ? [`${dir}${entry.name}`] : []);

test('review.js comes last in the panel list and every file in it exists', () => {
  assert.equal(PANEL_FILES.at(-1), 'review.js');
  for (const name of PANEL_FILES) assert.ok(fs.existsSync(new URL(`extension/${name}`, ROOT)), name);
});

test('no injector lists review.js alone: each one spreads PANEL_FILES (or names every part in order)', () => {
  const injectors = [...sources('extension/'), ...sources('desktop/lib/'), ...sources('tools/')].filter((path) => path !== 'extension/panel-files.js' && /files:\s*\[[^\]]*'review\.js'|['"]extension\/review\.js['"]\s*\]?\s*[,)]\s*\{?[^\n]*executeScript/.test(read(path)));
  assert.deepEqual(injectors, [], 'a file lists review.js in an executeScript files list without PANEL_FILES');
  assert.match(read('extension/background.js'), /files: \[[^\]]*\.\.\.PANEL_FILES[^\]]*\]/, 'the worker injects the whole list');
});

// Why (#2429, Gitar): review.js called the new __jobPilottoPanelView unconditionally but its guard did not name it, so a partial
// injection after a reload removed the panel and blanked it silently (mount() runs under .catch(() => {})) instead of naming the helper.
test('review.js guards every panel helper it calls without ?. so a partial injection draws nothing instead of throwing', () => {
  const review = read('extension/review.js');
  const guarded = JSON.parse(review.match(/\|\| (\[[^\]]*\])\.some\(name => !window\['__jobPilotto' \+ name\]/)[1].replaceAll("'", '"'));
  const defined = PANEL_FILES.filter((file) => file !== 'review.js').flatMap((file) => [...read(`extension/${file}`).matchAll(/window\.__jobPilotto(\w+) *=[^=]/g)].map((m) => m[1]));
  const optional = (name) => [...review.matchAll(new RegExp(`window\\.__jobPilotto${name}\\b(\\?\\.|\\))?`, 'g'))].every((m) => m[1] || review.includes(`if (window.__jobPilotto${name})`));
  const unguarded = defined.filter((name) => review.includes(`__jobPilotto${name}`) && !guarded.includes(name) && !optional(name));
  assert.deepEqual(unguarded, [], 'add these to the helper-script guard at the top of extension/review.js');
});

test('a panel part the worker injects is never loaded by another page script list', () => {
  for (const name of PANEL_FILES.filter((file) => file !== 'review.js')) assert.ok(!read('extension/page-files.js').includes(name), `${name} is a panel script, not a page script`);
});
