// Regenerate the fictional nightly request manifest offline, using real desktop senders and fingerprinted engine captures.
// Refresh engine captures first: python3 tools/ai-format-python-capture.py; then node tools/ai-format-capture.mjs.
// Reaches: ./ai-format-python-capture.py ../src/
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadTable} from '../desktop/e2e/lib/ai-answers.mjs';
import {captureDesktop} from './ai-format-js-capture.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GOLDEN = new URL('../desktop/e2e/fixtures/golden/', import.meta.url);
const PYTHON = new URL('ai-format-python.json', GOLDEN);
const MANIFEST = new URL('ai-format-manifest.json', GOLDEN);
const about = 'Fictional nightly AI-format requests captured offline through real senders; no AI calls. Regenerate with tools/ai-format-capture.mjs after refreshing its engine snapshots.';
// Canonical subtree bytes match Python json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False), UTF-8.
const canonical = value => JSON.stringify(value, (_key, part) => part && typeof part === 'object' && !Array.isArray(part)
  ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);

/** Verify offline engine fingerprints; root may point to an isolated repository copy. */
export function checkPython(snapshot, root = ROOT) {
  if (snapshot.v !== 1 || !snapshot.entries?.length || !Object.keys(snapshot.dependencies || {}).length) throw new Error('Missing fingerprinted engine captures');
  for (const [dependency, sha] of Object.entries(snapshot.dependencies)) {
    const [file, selector] = dependency.split('#');
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(path.resolve(root) + path.sep) || !/^(?:src|tools|desktop)\//.test(file)) throw new Error(`Invalid capture dependency ${dependency}`);
    const stale = () => new Error(`Engine capture stale: ${dependency}; run python3 tools/ai-format-python-capture.py`);
    let bytes = fs.readFileSync(resolved);
    if (selector !== undefined) {
      let value = JSON.parse(bytes), remaining = selector;
      if (!remaining) throw stale();
      while (remaining) {
        // Dotted object keys (app.interview) stay intact; prefer the longest matching key.
        const keys = value !== null && typeof value === 'object' ? Object.keys(value) : [];
        const key = keys
          .filter(key => remaining === key || remaining.startsWith(key + '.')).sort((a, b) => b.length - a.length)[0];
        if (key === undefined) throw stale();
        value = value[key];
        remaining = remaining.slice(key.length + 1);
      }
      bytes = canonical(value);
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== sha) throw stale();
  }
}

/** Return canonical manifest bytes in-process, without subprocesses, writes, accounts or transports. */
export async function captureManifest({pythonSnapshot = JSON.parse(fs.readFileSync(PYTHON, 'utf8'))} = {}) {
  checkPython(pythonSnapshot);
  const table = loadTable();
  // Why (30 Oct 2026, ap): caption-keyed app.interview and declared interview are one family, never two nightly calls.
  const declared = [...new Set([...Object.keys(table.kinds || {}), ...Object.keys(table.items || {}), ...Object.keys(table.answers || {})]
    .map(kind => kind === 'app.interview' ? 'interview' : kind))].sort();
  const entries = [...await captureDesktop(ROOT), ...pythonSnapshot.entries].sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
  if (JSON.stringify(entries.map(entry => entry.kind)) !== JSON.stringify(declared)) throw new Error('Capture coverage differs from the answer table declarations');
  // Why (30 Oct 2026, ap): one compact JSON entry per line keeps the reviewed fixture below 500 lines without hiding its request boundaries.
  return `{
"about":${JSON.stringify(about)},
"entries":[
${entries.map(canonical).join(',\n')}
],
"v":1
}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Offline capture takes no arguments and has no live mode');
  fs.writeFileSync(MANIFEST, await captureManifest());
  console.log(`Wrote ${fileURLToPath(MANIFEST)}`);
}
