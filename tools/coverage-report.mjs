// Nightly coverage report: line % per test layer and per folder, and which GTM journeys have a test at which layer. Report only: it never fails a run on a number.
// Reads up to four sources and says "not measured" for any that is missing or empty, never 0%:
//   unit Python         coverage.py's `coverage json` (--py)
//   unit JS             a NODE_V8_COVERAGE folder from `node --test desktop/test/*.test.js` (--unit-js)
//   integration (Node)  NODE_V8_COVERAGE folders from desktop/integration/{store,extension,app} (--integration-js, repeatable)
//   e2e (app window, extension, engine) the code → suite map that e2e.yml's coverage-map job keeps (--e2e-map; lib/coverage.mjs writes its inputs)
//   node tools/coverage-report.mjs --root . [--py f] [--unit-js dir] [--integration-js dir]... [--e2e-map f] [--journeys docs/gtm-journeys.json] --json out.json --md out.md
// Why (1 Nov 2026, owner via a8: "Yes, nightly report (Recommended)"): nobody could say how much of the code a layer runs, or which of the board's journeys have a test. Report only,
// allowed under the owner's freeze (no new guard, gate or check until 3 green nights): no PR trigger, nothing `needs` its job (.github/workflows/coverage-report.yml).
// Counting: JS and e2e count non-blank lines (a line is covered when a character on it ran); Python counts coverage.py's statements. Files no test loaded count as 0 in a measured layer.
// Tests: desktop/test/coverage-report.test.js
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// The product code a coverage % is about. `topOnly`: the files directly in the prefix (desktop/main.js, preload.cjs), not its sub-folders.
export const SCOPE = [
  {folder: 'src', prefix: 'src/', lang: 'py'},
  {folder: 'desktop/lib', prefix: 'desktop/lib/', lang: 'js'},
  {folder: 'desktop/renderer', prefix: 'desktop/renderer/', lang: 'js'},
  {folder: 'desktop (main process)', prefix: 'desktop/', lang: 'js', topOnly: true},
  {folder: 'extension', prefix: 'extension/', lang: 'js'},
  {folder: 'worker/src', prefix: 'worker/src/', lang: 'js'},
];
const EXT = {py: /\.py$/, js: /\.(js|mjs|cjs)$/};
const LEFT_OUT = /(^|\/)(node_modules|test|tests|fixtures|vendor|\.claude|\.git)\/|\.test\./;

/** The scope entry of a repo-relative path, or null (outside the scope, a test, a fixture, another language). */
export function scopeOf(rel) {
  if (LEFT_OUT.test(rel)) return null;
  return SCOPE.find(s => rel.startsWith(s.prefix) && EXT[s.lang].test(rel) && (!s.topOnly || !rel.slice(s.prefix.length).includes('/'))) || null;
}

const nonBlankLines = text => { const set = new Set(); text.split('\n').forEach((line, i) => { if (line.trim()) set.add(i + 1); }); return set; };

/** Every in-scope file of the checkout: Map rel → {folder, lang, nonblank: Set of line numbers}. */
export function walkScope(root) {
  const files = new Map();
  const walk = dir => {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}) : []) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full); continue; }
      const rel = path.relative(root, full).split(path.sep).join('/');
      const scope = scopeOf(rel);
      if (scope) files.set(rel, {folder: scope.folder, lang: scope.lang, nonblank: nonBlankLines(fs.readFileSync(full, 'utf8'))});
    }
  };
  for (const top of new Set(SCOPE.map(s => s.prefix.split('/')[0]))) walk(path.join(root, top));
  return files;
}

/** The 1-based lines of `source` a V8 coverage entry ran: the file's function ranges laid outer first, so a nested range with count 0 (a branch or function never run) cuts its lines out. */
export function coveredLines(source, functions) {
  const counts = new Int32Array(source.length).fill(-1);
  const ranges = (functions || []).flatMap(fn => fn.ranges || []).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) counts.fill(r.count, Math.max(0, r.startOffset), Math.min(source.length, r.endOffset));
  const covered = new Set();
  let offset = 0;
  source.split('\n').forEach((line, i) => {
    for (let k = 0; k < line.length; k++) if (line[k].trim() && counts[offset + k] > 0) { covered.add(i + 1); break; }
    offset += line.length + 1;
  });
  return covered;
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const unmeasured = why => ({measured: false, why, files: new Map()});
const union = (into, rel, lines) => { const set = into.get(rel) || new Set(); for (const n of lines) set.add(n); into.set(rel, set); };

/** NODE_V8_COVERAGE folders → {measured, files: Map rel → {lines: Set}}. A folder that is missing or holds no in-scope file is "not measured". */
export function readV8(dirs, root) {
  const lines = new Map();
  const names = [];
  for (const dir of dirs.filter(Boolean)) {
    if (!fs.existsSync(dir)) continue;
    names.push(...fs.readdirSync(dir).filter(name => /^coverage-.*\.json$/.test(name)).map(name => path.join(dir, name)));
  }
  if (!names.length) return unmeasured(dirs.filter(Boolean).length ? 'no V8 coverage files were written' : 'no coverage folder given');
  for (const name of names) {
    let data;
    try { data = readJson(name); } catch { continue; }   // a file cut short by a killed process: the others still count
    for (const entry of data.result || []) {
      if (!String(entry.url).startsWith('file:')) continue;
      const rel = path.relative(root, fileURLToPath(entry.url)).split(path.sep).join('/');
      if (!scopeOf(rel) || !fs.existsSync(path.join(root, rel))) continue;
      union(lines, rel, coveredLines(fs.readFileSync(path.join(root, rel), 'utf8'), entry.functions));
    }
  }
  if (!lines.size) return unmeasured('the coverage files hold none of the product code');
  return {measured: true, files: new Map([...lines].map(([rel, set]) => [rel, {lines: set}]))};
}

/** coverage.py's `coverage json` → {measured, files: Map rel → {covered, total}} (statements). */
export function readPython(file, root) {
  if (!file || !fs.existsSync(file)) return unmeasured('no coverage.py JSON');
  let data;
  try { data = readJson(file); } catch (error) { return unmeasured(`coverage.py JSON unreadable: ${error.message}`); }
  const files = new Map();
  for (const [name, entry] of Object.entries(data.files || {})) {
    const rel = path.isAbsolute(name) ? path.relative(root, name).split(path.sep).join('/') : name.split('\\').join('/');
    if (scopeOf(rel)) files.set(rel, {covered: entry.summary?.covered_lines ?? 0, total: entry.summary?.num_statements ?? 0});
  }
  return files.size ? {measured: true, files} : unmeasured('coverage.py listed none of the product code');
}

/** The e2e coverage map (lib/coverage-pick.mjs: {suites: {name: {sha, at, files: {path: {lines: [[from, to]]}}}}}) → the union of the lines every suite ran. */
export function readE2eMap(file) {
  if (!file || !fs.existsSync(file)) return unmeasured('no e2e coverage map');
  let map;
  try { map = readJson(file); } catch (error) { return unmeasured(`e2e coverage map unreadable: ${error.message}`); }
  const lines = new Map();
  const shas = new Set();
  for (const suite of Object.values(map.suites || {})) {
    if (suite.sha) shas.add(String(suite.sha).slice(0, 7));
    for (const [rel, entry] of Object.entries(suite.files || {})) {
      if (!scopeOf(rel)) continue;
      const set = lines.get(rel) || new Set();
      for (const [from, to] of entry.lines || []) for (let n = from; n <= to; n++) set.add(n);
      lines.set(rel, set);
    }
  }
  if (!lines.size) return unmeasured('the e2e map holds none of the product code');
  return {measured: true, note: `${Object.keys(map.suites).length} suites at ${[...shas].join(', ') || 'unknown commits'}`, files: new Map([...lines].map(([rel, set]) => [rel, {lines: set}]))};
}

/** One layer × folder cell. A folder whose language the layer cannot see is "n/a"; an unmeasured layer is "not measured". */
function cell(layer, folder, tree) {
  const inFolder = [...tree].filter(([, f]) => f.folder === folder);
  if (!inFolder.length || !layer.langs.includes(inFolder[0][1].lang)) return {state: 'n/a'};
  if (!layer.measured) return {state: 'not measured'};
  let covered = 0, total = 0;
  for (const [rel, file] of inFolder) {
    const got = layer.files.get(rel);
    if (got?.total != null) { covered += got.covered; total += got.total; continue; }
    total += file.nonblank.size;
    if (got?.lines) for (const n of got.lines) if (file.nonblank.has(n)) covered++;
  }
  return {state: 'measured', covered, total, pct: total ? Math.round((1000 * covered) / total) / 10 : 0};
}

const sumCells = cells => {
  const live = cells.filter(c => c.state === 'measured');
  if (!live.length) return cells.some(c => c.state === 'not measured') ? {state: 'not measured'} : {state: 'n/a'};
  const covered = live.reduce((s, c) => s + c.covered, 0), total = live.reduce((s, c) => s + c.total, 0);
  return {state: 'measured', covered, total, pct: total ? Math.round((1000 * covered) / total) / 10 : 0};
};

/**
 * A suite's cadence as its module exports it, read from the text (importing a suite would load Playwright): `export const cadence = 'night-report'`, or `= PLANNER.cadence` followed to the
 * module that imports PLANNER from and holds `cadence: '…'` (qualityai, lib/quality-journey.mjs). '' when it says nothing readable.
 */
export function suiteCadence(root, suite) {
  const file = path.join(root, 'desktop/e2e/suites', `${suite}.mjs`);
  if (!fs.existsSync(file)) return '';
  const text = fs.readFileSync(file, 'utf8');
  const literal = /export const cadence\s*=\s*'([^']+)'/.exec(text);
  if (literal) return literal[1];
  const named = /export const cadence\s*=\s*(\w+)\.cadence\b/.exec(text);
  const from = named && new RegExp(`import\\s*\\{[^}]*\\b${named[1]}\\b[^}]*\\}\\s*from\\s*'([^']+)'`).exec(text);
  const source = from && path.resolve(path.dirname(file), from[1]);
  return source && fs.existsSync(source) ? (/\bcadence:\s*'([^']+)'/.exec(fs.readFileSync(source, 'utf8')) || [])[1] || '' : '';
}

/** The journeys of the GTM board (docs/gtm-journeys.json) with the layers that test each, from facts in the checkout: the e2e registry, the integration and unit files that exist. */
export function journeyTable({journeys, registry, root}) {
  const tier1 = new Set([...(registry?.journeys || []).filter(j => j.tier === 1).flatMap(j => (j.steps || []).map(s => s.suite)), ...(registry?.kept || []).map(s => s.suite)].filter(Boolean));
  const integrationDir = path.join(root, 'desktop/integration');
  const flat = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const walkFiles = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [e.name])) : []);
  const integration = walkFiles(integrationDir).filter(name => /\.test\.m?js$/.test(name)).map(flat);
  const nightly = suite => suiteCadence(root, suite) === 'night-report';
  return (journeys || []).map(j => {
    const suites = j.suites || [];
    const e2e = suites.filter(s => tier1.has(s));
    const integ = suites.filter(s => integration.some(name => name.includes(flat(s))));
    const night = suites.filter(s => !tier1.has(s) && nightly(s));
    const units = (j.unit || []).filter(file => fs.existsSync(path.join(root, file)));
    const layers = [e2e.length && 'e2e', integ.length && 'integration', units.length && 'unit', night.length && 'nightly report'].filter(Boolean);
    return {n: j.n, name: j.name, priority: j.priority, card: j.card, layers, e2e, integration: integ, unit: units, nightly: night, tested: layers.length > 0};
  });
}

/** Everything the report says, as data. layers: [{id, label, langs, measured, why, files}] from the readers above. */
export function buildReport({tree, layers, journeys}) {
  const folders = SCOPE.map(s => s.folder);
  const rows = folders.map(folder => ({folder, cells: Object.fromEntries(layers.map(l => [l.id, cell(l, folder, tree)]))}));
  const perLayer = layers.map(l => ({id: l.id, label: l.label, measured: l.measured, why: l.why || '', note: l.note || '', total: sumCells(folders.map(f => cell(l, f, tree)))}));
  const withTest = journeys.filter(j => j.tested).length;
  const byLayer = {};
  for (const j of journeys) for (const layer of j.layers) byLayer[layer] = (byLayer[layer] || 0) + 1;
  return {layers: perLayer, folders: rows, journeys: {total: journeys.length, withTest, without: journeys.length - withTest, byLayer, list: journeys}};
}

const show = c => (c.state === 'measured' ? `${c.pct}%` : c.state);

/** The report as a Markdown text (also what the log prints). */
export function renderMarkdown(report, {sha = '', at = ''} = {}) {
  const ids = report.layers.map(l => l.id);
  const out = [`# Coverage report${sha ? ` · ${sha.slice(0, 7)}` : ''}${at ? ` · ${at}` : ''}`, '', 'Report only: nothing here fails or blocks a run. "not measured" = that source was missing or empty tonight (never 0%); "n/a" = the layer cannot see that folder.', ''];
  out.push('## Line % per layer', '', '| Layer | Line % | Lines | Note |', '|---|---|---|---|');
  for (const l of report.layers) out.push(`| ${l.label} | ${show(l.total)} | ${l.total.state === 'measured' ? `${l.total.covered} / ${l.total.total}` : ''} | ${l.measured ? l.note : l.why} |`);
  out.push('', '## Line % per folder', '', `| Folder | ${report.layers.map(l => l.label).join(' | ')} |`, `|---|${ids.map(() => '---').join('|')}|`);
  for (const row of report.folders) out.push(`| ${row.folder} | ${ids.map(id => show(row.cells[id])).join(' | ')} |`);
  const j = report.journeys;
  out.push('', `## GTM journeys with a test: ${j.withTest} of ${j.total}`, '', Object.entries(j.byLayer).map(([layer, n]) => `${layer}: ${n}`).join(' · ') || 'no layer', '', '| # | Journey | Priority | Layers |', '|---|---|---|---|');
  for (const item of j.list) out.push(`| ${item.n} | ${item.name} | ${item.priority} | ${item.tested ? item.layers.join(', ') : '**no test**'} |`);
  return out.join('\n') + '\n';
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : ''; }
const args = (argv, name) => argv.flatMap((v, i) => (v === name ? [argv[i + 1]] : []));

/** The command line. Returns the report; writes --json and --md when given. */
export function main(argv = process.argv.slice(2)) {
  const root = path.resolve(arg(argv, '--root') || '.');
  const tree = walkScope(root);
  const pick = (id, label, langs, read) => ({id, label, langs, ...read});
  const layers = [
    pick('unit-py', 'Unit · Python', ['py'], readPython(arg(argv, '--py'), root)),
    pick('unit-js', 'Unit · JS', ['js'], readV8([arg(argv, '--unit-js')], root)),
    pick('integration', 'Integration · Node', ['js'], readV8(args(argv, '--integration-js'), root)),
    pick('e2e', 'E2E · app, extension, engine', ['js', 'py'], readE2eMap(arg(argv, '--e2e-map'))),
  ];
  const journeysFile = arg(argv, '--journeys');
  const registryFile = path.join(root, 'desktop/e2e/critical-journeys.json');
  const journeys = journeyTable({
    journeys: journeysFile && fs.existsSync(journeysFile) ? readJson(journeysFile).journeys : [],
    registry: fs.existsSync(registryFile) ? readJson(registryFile) : null,
    root,
  });
  const report = buildReport({tree, layers, journeys});
  const meta = {sha: arg(argv, '--sha'), at: arg(argv, '--at')};
  const md = renderMarkdown(report, meta);
  if (arg(argv, '--json')) { fs.mkdirSync(path.dirname(arg(argv, '--json')), {recursive: true}); fs.writeFileSync(arg(argv, '--json'), JSON.stringify({...meta, ...report}, null, 1)); }
  if (arg(argv, '--md')) { fs.mkdirSync(path.dirname(arg(argv, '--md')), {recursive: true}); fs.writeFileSync(arg(argv, '--md'), md); }
  process.stdout.write(md);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
