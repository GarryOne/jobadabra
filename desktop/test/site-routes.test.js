// Every website route that shipped code calls is in docs/site-routes.json (the public list of what the site answers), and every route listed for the app is still called.
// Pairs with test/site-routes.test.js (the site proves it answers each listed route). Spec: private spec jobadabra-lab:docs/specs/2026-10-19-site-private-repo.md.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'docs/site-routes.json'), 'utf8'));
const SHIPPED = ['desktop/lib', 'desktop/main.js', 'desktop/renderer', 'extension', 'src', 'app-core/src', 'hosted'];
const TEXT = /\.(js|mjs|cjs|py|html)$/;

function files(path) {
  const full = join(ROOT, path);
  if (!statSync(full, {throwIfNoEntry: false})) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, {withFileTypes: true}).flatMap(entry =>
    entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : entry.isDirectory() ? files(join(path, entry.name)) : TEXT.test(entry.name) ? [join(full, entry.name)] : []);
}
const sources = SHIPPED.flatMap(files).map(file => ({file: file.slice(ROOT.length), text: readFileSync(file, 'utf8')}));

// Our routes in code: a path literal that starts right after a quote ('/api/x'), or sits after our host. A third-party URL has its own host in front of /api/, so it never matches.
const OURS = /(?:['"`]|jobpilotto\.(?:top|workers\.dev))(\/(?:api|report)\/[A-Za-z][A-Za-z0-9/_.-]*)/g;
const listed = path => manifest.routes.some(route => route.path === path || (route.prefix && (path.startsWith(route.path) || `${path}/` === route.path)));

test('every site route that shipped code writes out is in the list', () => {
  const unlisted = [];
  for (const {file, text} of sources) {
    for (const match of text.matchAll(OURS)) if (!listed(match[1])) unlisted.push(`${file}: ${match[1]}`);
  }
  assert.deepEqual(unlisted, [], 'add the route to docs/site-routes.json and to the site (kind "app")');
});

test('every route listed for the app is still written somewhere in shipped code', () => {
  const all = sources.map(source => source.text).join('\n');
  const gone = manifest.routes.filter(route => route.kind === 'app' && !all.includes(route.path) && !all.includes(route.path.replace(/^\/api/, '')) && !all.includes(route.path.replace(/\/$/, '')) && !(route.path.split('/').length > 4 && all.includes(route.path.replace(/[^/]+$/, '') + '${')))
    .map(route => route.path);
  assert.deepEqual(gone, [], 'no shipped code calls these any more: drop them from docs/site-routes.json (kind "app") or change the kind');
});

test('the scan finds the routes the app is known to call (it cannot pass by finding nothing)', () => {
  const found = new Set(sources.flatMap(({text}) => [...text.matchAll(OURS)].map(match => match[1])));
  for (const path of ['/api/index', '/report/telemetry', '/api/contribute', '/api/feedback']) assert.ok(found.has(path), path);
  assert.ok(found.size >= 15, `routes found: ${found.size}`);
});
