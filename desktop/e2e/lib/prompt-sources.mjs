// The files that decide what the AI is asked when the app fills a form, beyond the ladder prompts the fingerprint already hashes: the automatic refill on main starts when a merge changes one (owner, 15 Oct 2026, after #904 and #912 changed the worker's field list and cv_facts rule and no refill ran).
// Job: serve stored answers
// A file here is hashed whole (its git blob), so a comment-only edit refills too (cents: only the missed asks are paid). Guard: e2e/test/refill.test.mjs (every ladder prompt file is covered; the workflow's push paths list exactly these).
import {execFileSync} from 'node:child_process';
import {PROMPT_FILES} from './ladder-fingerprint.mjs';

// Worker: the instructions, the fact rule, the missing-field re-ask, the CV facts. Extension: the field list read from the page (what each field carries to the worker).
export const WORKER_AND_PAGE_SOURCES = ['app-core/src/extension.js', 'app-core/src/answer-declarations.js', 'app-core/src/answer-examples.js', 'app-core/src/answer-facts.js', 'app-core/src/answer-missing.js', 'app-core/src/cv-facts.js', 'app-core/src/written-answer.js', 'extension/page/fill-read.js'];
export const LADDER_BASELINE = 'desktop/e2e/ladder-baseline.json';

// Every file whose change can change an ask: the ladder prompt files (their prompts are also hashed in the baseline), the worker and page files above.
export const PROMPT_SOURCES = [...new Set([...PROMPT_FILES.map(item => item.file), ...WORKER_AND_PAGE_SOURCES])].sort();

// ({file: blob id | null} before, after) -> the files whose content differs. A missing "before" (no earlier commit) changes everything that exists now.
export const sourcesChanged = (before = {}, after = {}) => PROMPT_SOURCES.filter(file => (before?.[file] ?? null) !== (after?.[file] ?? null));

// A commit (or "HEAD") -> {file: blob id | null}; null for every file when the commit is not known here (a first push, a shallow clone).
export function blobsAt(commit, run = (args) => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})) {
  const found = {};
  for (const file of PROMPT_SOURCES) { try { found[file] = run(['rev-parse', `${commit}:${file}`]).trim() || null; } catch { found[file] = null; } }
  return found;
}
