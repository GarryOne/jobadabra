// The code a finding points at, fetched by code and put in the judge's prompt: the broker answers one prompt with no tools, so what the Claude session used to grep and Read comes here.
//   evidenceFor({text, logs, root, budget}) -> a text block: the cited file:line excerpts, the places the finding's quoted words are written, the step's logs.
// Why (31 Oct 2026, owner: CI AI on the Codex plan): the verdict pass searched the renderer for the words on screen ("find the file by grepping the exact words", ui-verdict-prompt.md) with up to 25 tool turns.
// The grep is a fixed-string search, not a judgement, so code does it and the AI judges what it finds. Pure but for reading files and `git grep`.
// Job: report health
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {refsIn} from './verdict-comment.mjs';

export const ROOTS = ['desktop/renderer', 'desktop/lib', 'desktop/main.js', 'extension', 'src'];
const QUOTED = /(?:"|“|`)([^"”`\n]{6,90})(?:"|”|`)/g;
const MAX_QUOTES = 8;
const MAX_HITS = 6;
export const CALLERS_BUDGET = 12000;   // characters of call sites per finding, out of the evidence budget

const numbered = (lines, from) => lines.map((line, i) => `${from + i}: ${line}`).join('\n');

/** The file's lines `line - radius .. line + radius` with their numbers, or its first 2 * radius lines when no line is given; '' for a file that does not exist. */
export function excerpt(file, line, {root = '.', radius = 30} = {}) {
  let lines;
  try { lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n'); } catch { return ''; }
  const at = Number(line) || 0, from = at ? Math.max(1, at - radius) : 1, to = at ? Math.min(lines.length, at + radius) : Math.min(lines.length, radius * 2);
  return numbered(lines.slice(from - 1, to), from);
}

/** The words a finding quotes (in double quotes or backticks), longest first, without file references: what a person would search the code for. */
export function quotedWords(text) {
  const found = [...String(text || '').matchAll(QUOTED)].map(match => match[1].trim()).filter(word => word && !/^[\w./-]+\.\w+(?::\d+)?$/.test(word));
  return [...new Set(found)].sort((a, b) => b.length - a.length).slice(0, MAX_QUOTES);
}

function grep(word, roots, root, whole = false) {
  try {
    const out = execFileSync('git', ['grep', '-n', '-F', ...(whole ? ['-w'] : []), '-e', word, '--', ...roots], {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']});
    return out.split('\n').filter(Boolean).slice(0, MAX_HITS).map(row => { const [, file, line, rest] = /^([^:]+):(\d+):(.*)$/.exec(row) || []; return file ? {file, line: Number(line), text: rest.trim().slice(0, 200)} : null; }).filter(Boolean);
  } catch { return []; }   // git grep exits 1 for no match
}

const NOT_A_NAME = new Set(['function', 'return', 'catch', 'await', 'async', 'const', 'import', 'export', 'filter', 'forEach', 'concat', 'slice', 'push', 'join', 'then', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Promise', 'Error', 'console', 'document', 'window', 'querySelector', 'textContent', 'innerHTML', 'addEventListener', 'getElementById', 'setAttribute', 'classList', 'print', 'range', 'len', 'str', 'dict', 'list', 'isinstance', 'format', 'strip', 'split', 'startswith', 'endswith']);
const DECLARES = [/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/, /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/, /^\s*(?:async\s+)?def\s+(\w+)/, /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{\s*$/];

/** The names a cited line is about: the function it sits in (the nearest declaration above, within 120 lines) and the functions it calls (4+ letters). At most 3, none of them common words. */
export function symbolsAt(file, line, root = '.') {
  let lines;
  try { lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n'); } catch { return []; }
  const at = Math.min(lines.length, Number(line) || 0);
  if (!at) return [];
  const names = [];
  for (let i = at - 1; i >= Math.max(0, at - 121) && !names.length; i--) for (const re of DECLARES) { const hit = re.exec(lines[i]); if (hit && !NOT_A_NAME.has(hit[1])) { names.push(hit[1]); break; } }
  for (const match of lines[at - 1].matchAll(/\b([A-Za-z_]\w{3,})\s*\(/g)) if (!NOT_A_NAME.has(match[1])) names.push(match[1]);
  return [...new Set(names)].slice(0, 3);
}

/** Where `name` is used outside its own file's declaration: `git grep -w`, the first call sites with a few lines around them. Returns [{title, body}] within `budget` characters. */
export function callersOf(name, {file, root = '.', budget = 4000} = {}) {
  const hits = grep(name, ROOTS, root, true).filter(hit => !new RegExp(`(function|def|const|let)\\s+${name}\\b`).test(hit.text));
  if (!hits.length) return [];
  const out = [{title: `uses of ${name}() (git grep -w)`, body: hits.map(hit => `${hit.file}:${hit.line}: ${hit.text}`).join('\n')}];
  let used = out[0].body.length;
  for (const hit of hits.filter(item => item.file !== file).slice(0, 3)) {
    const body = excerpt(hit.file, hit.line, {root, radius: 10});
    if (used + body.length > budget) break;
    used += body.length;
    out.push({title: `${hit.file}:${hit.line} (calls ${name})`, body});
  }
  return out;
}

const tail = (file, count, root) => { try { return fs.readFileSync(path.join(root, file), 'utf8').split('\n').slice(-count).join('\n'); } catch { return ''; } };
const recent = (file, root) => { try { return execFileSync('git', ['log', '--format=%h %ad %s', '--date=short', '-4', '--', file], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; } };

/**
 * Takes {text: the finding's words, logs: [file paths of the failed step's logs], root, budget: characters}. Returns the evidence block, cut at the budget.
 * Order: what the finding cites (file:line), then where its quoted words are written, then the logs; each part is skipped when empty.
 */
export function evidenceFor({text, logs = [], root = '.', budget = 30000}) {
  const parts = [];
  const suite = logs.map(file => /e2e-artifacts-([a-z0-9-]+)/.exec(file)?.[1]).find(Boolean);
  const roots = suite && fs.existsSync(path.join(root, 'desktop/e2e/suites')) ? [...ROOTS, 'desktop/e2e/suites'] : ROOTS;
  const seen = new Set(), focus = [];
  const add = (title, body) => { if (body && body.trim()) parts.push(`=== ${title} ===\n${body}`); };
  for (const ref of refsIn(text).slice(0, 6)) {
    const [file, lines] = ref.split(':');
    const at = String(lines || '').split('-')[0];
    if (seen.has(`${file}:${at}`)) continue;
    seen.add(`${file}:${at}`);
    seen.add(`${file}:${Math.floor(Number(at) / 40)}`);   // the same lines are not shown again as a search hit
    const body = excerpt(file, at, {root});
    add(`${file}${at ? `:${at}` : ''} (cited by the finding)`, body);
    if (body && at) focus.push({file, line: at});
    const log = body && recent(file, root);
    if (log) add(`git log of ${file}`, log);
  }
  for (const word of quotedWords(text)) {
    const hits = grep(word, roots, root);
    if (!hits.length) { add(`search for "${word}"`, 'no file under the product code writes these words'); continue; }
    add(`search for "${word}" (git grep)`, hits.map(hit => `${hit.file}:${hit.line}: ${hit.text}`).join('\n'));
    if (focus.length < 4) focus.push({file: hits[0].file, line: hits[0].line});
    for (const hit of hits.slice(0, 2)) {
      const key = `${hit.file}:${Math.floor(hit.line / 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(`${hit.file}:${hit.line} (writes "${word}")`, excerpt(hit.file, hit.line, {root, radius: 20}));
    }
  }
  // Why (31 Oct 2026, owner: quality before cost; first live run, ui-verdict 41220547004): 3 of 4 verdicts came back needs-human, "the evidence does not include the caller", against 25% before. The session followed the flagged code to its callers; so does this.
  const callers = [], named = new Set();
  for (const {file, line} of focus) for (const name of symbolsAt(file, line, root)) if (!named.has(name)) { named.add(name); callers.push(...callersOf(name, {file, root})); }
  let room = CALLERS_BUDGET;
  for (const part of callers) { if (part.body.length > room) break; room -= part.body.length; add(part.title, part.body); }
  for (const file of logs) add(`${path.basename(file)} (the last 80 lines of the failed step's log)`, tail(file, 80, root));
  const joined = parts.join('\n\n');
  return joined.length > budget ? `${joined.slice(0, budget)}\n[evidence cut at ${budget} characters]` : joined;
}

/** The planted code of a judge-exam finding (lib/judge-exam.mjs): its excerpt files in full, named as printed (they carry their own line numbers). */
export function examEvidence(dir) {
  try { return fs.readdirSync(dir).sort().map(name => `=== ${name} ===\n${fs.readFileSync(path.join(dir, name), 'utf8')}`).join('\n\n'); } catch { return ''; }
}
