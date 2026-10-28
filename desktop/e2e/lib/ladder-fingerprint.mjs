// The prompt fingerprint of the ladder: one hash per model-facing prompt and schema (rung 2, rung 3, the account judge, the form judge, rung 4). The push gate replays STORED answers, so without this it would never
// see a changed prompt or schema; a hash that differs from e2e/ladder-baseline.json (promptFingerprint) fails the ratchet and says what to re-run. Guard: test/ladder-fingerprint.test.js.
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// key: the baseline's name · label: how the failure names it · file: repo-relative · parts: the exported constants that reach the model (an object is hashed as JSON, a function by its source)
export const PROMPT_FILES = [
  {key: 'rung2', label: 'rung 2', file: 'desktop/lib/ladder/rung2-sketch.js', parts: ['SCHEMA', 'INSTRUCTIONS', 'FORM_CHECK_RULE']},
  {key: 'rung2-frames', label: 'rung 2 (the frame rule, only asked with frame candidates)', file: 'desktop/lib/ladder/rung2-sketch.js', parts: ['FRAME_RULE']},
  {key: 'rung3', label: 'rung 3', file: 'desktop/lib/ladder/rung3-digest.js', parts: ['DIGEST_INSTRUCTIONS', 'DIGEST_SCHEMA', 'FRAME_RULE']},
  {key: 'account-judge', label: 'the account judge', file: 'desktop/lib/account-judge.js', parts: ['INSTRUCTIONS', 'schema']},
  {key: 'form-judge', label: 'the form judge', file: 'desktop/lib/form-judge.js', parts: ['INSTRUCTIONS', 'STEP_RULE', 'SUBMIT_RULE', 'BLOCKED_RULE', 'schema']},
  {key: 'fill-verify', label: 'the fill check (fill_verify)', file: 'desktop/lib/ladder/fill-verify.js', parts: ['INSTRUCTIONS', 'schema']},
  {key: 'fill-repair', label: 'the fill repair (fill_repair)', file: 'desktop/lib/ladder/fill-repair.js', parts: ['INSTRUCTIONS', 'schema']},
  {key: 'rung4', label: 'rung 4', file: 'desktop/lib/ladder/rung4-picture.js', parts: ['INSTRUCTIONS', 'PAGE_INSTRUCTIONS', 'FORM_INSTRUCTIONS', 'SCHEMA']},
];

const canon = value => (typeof value === 'function' ? String(value) : typeof value === 'string' ? value : JSON.stringify(value));
export const hashOf = values => crypto.createHash('sha1').update(values.map(canon).join('\n--\n')).digest('hex').slice(0, 16);

// -> {key: hash}. `load(repoRelativeFile)` imports a module (a test gives it a copy with a changed string).
export async function fingerprints({load = file => import(pathToFileURL(path.join(repo, file)).href)} = {}) {
  const found = {};
  for (const item of PROMPT_FILES) {
    const module = await load(item.file);
    const missing = item.parts.filter(name => module[name] === undefined);
    if (missing.length) throw new Error(`${item.file} does not export ${missing.join(', ')}: the prompt fingerprint reads them (keep the export keyword)`);
    found[item.key] = hashOf(item.parts.map(name => module[name]));
  }
  return found;
}

// -> [message]: a prompt whose hash differs from the baseline's (or has none). Empty when the tree matches.
export function fingerprintProblems(current, baseline) {
  const kept = baseline?.promptFingerprint;
  if (!kept) return ['no prompt fingerprint in the baseline: run `npm run ladder-score -- --offline --update-baseline "<why>"` once to record it'];
  const problems = [];
  for (const item of PROMPT_FILES) {
    if (!kept[item.key]) problems.push(`no fingerprint for ${item.label} in the baseline: run \`--offline --update-baseline "<why>"\``);
    else if (current[item.key] !== kept[item.key]) problems.push(`the prompt of ${item.label} changed: re-run \`npm run ladder-score\` live (plan path), \`--record\` the changed answers, then \`--offline --update-baseline "<why>"\``);
  }
  return problems;
}
