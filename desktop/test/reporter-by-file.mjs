// A node:test reporter that prints one line per test FILE, OK or FAILED, and the full error of every failing test (owner, 10 Oct 2026: "100-1000 lines with OK/Failed
// and the error if there is one": without a terminal node --test prints TAP, 6 lines a test, 10,000 lines for this suite). Used by `npm test` (package.json).
// Live (owner, 1 Nov 2026: "I don't see any live logs/updates of what being run ... to be live and summarized"): a start line, a progress line about every 25 s of quiet or every 10% of the files,
// and a failing test at once with its error; the end summary below is unchanged (errors first, one line per file, the total). Guarded by test/reporter-by-file.test.js.
import fs from 'node:fs';
import path from 'node:path';

// Why (1 Nov 2026): the reporter used to yield only after the whole run, so a 4-minute run was silent. JOB_PILOTTO_PROGRESS_MS is the test seam for the quiet interval.
const QUIET_MS = Number(process.env.JOB_PILOTTO_PROGRESS_MS) || 25000;
const TICK = Symbol('tick');
const clock = ms => { const seconds = Math.round(ms / 1000); return seconds >= 60 ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`; };
// How many test files this run was asked for: the patterns node --test got, expanded; null when they cannot be expanded (the progress line then has no total).
export function countFiles(patterns = process.argv.slice(1), glob = fs.globSync) {
  try { const list = patterns.filter(item => !item.startsWith('-')); return list.length && glob ? new Set(glob(list)).size || null : null; } catch { return null; }
}

// The error's own lines, without Node's runner frames (node:internal, node:async_hooks): the first frames of the test file are what a person needs.
const clip = (text, lines) => String(text || '').split('\n').filter(line => !/node:(internal|async_hooks)/.test(line)).slice(0, lines).join('\n');

// One finished test counted into its file's entry. Returns the text to print at once when it is a failure (a suite and the parent of a failing subtest count nothing: the subtest is listed itself), else ''.
function record(of, type, data) {
  if (data.details?.type === 'suite') return '';   // a suite is its tests; counting it twice would show a pass for a failing file
  const error = data.details?.error;
  if (type === 'test:fail' && !data.skip && !data.todo && error?.code === 'ERR_TEST_FAILURE' && /subtests? failed/.test(error.message || '')) return '';
  const entry = of(data);
  if (nesting(data) === 0) entry.ms += data.details?.duration_ms || 0;
  if (data.skip || data.todo) { entry.skipped++; return ''; }
  if (type === 'test:pass') { entry.pass++; return ''; }
  entry.fail++;
  const failure = {name: data.name, message: clip(error?.cause?.stack || error?.cause?.message || error?.stack || error?.message || String(error || ''), 25)};
  entry.failures.push(failure);
  return `  ✖ ${failure.name}   (${path.relative(process.cwd(), data.file || '(unknown file)')})\n${indent(failure.message)}\n`;
}
const indent = text => text.split('\n').map(line => `      ${line}`).join('\n');

export default async function* byFile(source) {
  const files = new Map();
  const of = data => {
    const file = path.relative(process.cwd(), data.file || '(unknown file)');
    if (!files.has(file)) files.set(file, {pass: 0, fail: 0, skipped: 0, ms: 0, failures: []});
    return files.get(file);
  };
  let diagnostics = [], failed = 0;
  const label = `${path.basename(process.cwd())} tests`, total = countFiles(), began = Date.now();
  let lastLine = began, step = 1;
  const progress = () => { lastLine = Date.now(); return `${label}: ${files.size}${total ? `/${total}` : ''} files · ${failed} failed · ${clock(lastLine - began)}\n`; };
  yield `${label}: started${total ? ` · ${total} files` : ''}\n`;
  const iterator = source[Symbol.asyncIterator]();
  let pending = iterator.next();
  for (;;) {
    let timer;
    const quiet = new Promise(resolve => { timer = setTimeout(resolve, QUIET_MS, TICK); });
    const next = await Promise.race([pending, quiet]);
    clearTimeout(timer);
    if (next === TICK) { yield progress(); continue; }   // nothing came for a while: say it is still running
    if (next.done) break;
    pending = iterator.next();
    const {type, data} = next.value;
    if (type === 'test:pass' || type === 'test:fail') {
      const text = record(of, type, data);
      if (text) { failed++; yield text; }   // a failing test at once, the end summary lists it again
    } else if (type === 'test:diagnostic' && !/^(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(data.message)) diagnostics.push(data.message);
    if (total && files.size >= Math.ceil(total * step / 10)) { step = Math.floor(files.size * 10 / total) + 1; yield progress(); }   // every ~10% of the files
    else if (Date.now() - lastLine >= QUIET_MS) yield progress();
  }
  let pass = 0, fail = 0, skipped = 0;
  const sorted = [...files].sort(([a], [b]) => a.localeCompare(b));
  for (const [, entry] of sorted) { pass += entry.pass; fail += entry.fail; skipped += entry.skipped; }
  // What failed comes FIRST, in full, so a red log opens on the error; then one line per file (OK / FAILED); then the summary.
  if (fail) {
    yield `${fail} failing test${fail === 1 ? '' : 's'}:\n`;
    for (const [file, entry] of sorted) for (const failure of entry.failures) yield `\n  ✖ ${failure.name}   (${file})\n${indent(failure.message)}\n`;
    yield '\nAll files:\n';
  }
  for (const [file, entry] of sorted) {
    const count = `${entry.pass + entry.fail} test${entry.pass + entry.fail === 1 ? '' : 's'}`;
    yield `${entry.fail ? 'FAILED' : 'OK    '}  ${file}  (${count}, ${Math.round(entry.ms)} ms)\n`;
  }
  for (const message of diagnostics) yield `note: ${message}\n`;
  yield `\n${fail ? 'FAILED' : 'OK'}: ${files.size} files, ${pass + fail} tests, ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}\n`;
}
const nesting = data => data.nesting || 0;
