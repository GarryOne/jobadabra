// The verdict pass on the owner's Codex plan (the broker), in place of claude-code-action: judges UI-loop findings from the code and logs put in the prompt, writes the file the next step reads.
//   node judge-codex.mjs --mode verdict  [--heal .heal]   ui-verdict.yml: .heal/prompt.md + screenshot.png      -> .heal/verdict.md  (apply-verdict.sh)
//   node judge-codex.mjs --mode prejudge [--heal .heal]   ui-findings.yml: .heal/prejudge-prompt.md + pending.json -> .heal/verdicts.md (prejudge.mjs --parse)
//   node judge-codex.mjs --mode exam     [--heal .heal]   judge-exam.yml: .heal/exam-prompt.md + pending.json      -> .heal/verdicts.md (judge-exam.mjs --score)
// Why (31 Oct 2026, owner: "Why Anthropic is reached? We should use fully the Codex"; run of CI · UI verdicts, 4 jobs "Credit balance is too low"): the Claude step opened files with up to 25 tool turns. One broker call has
// no tools, so lib/judge-evidence.mjs fetches the cited code, the places the finding's words are written and the step's logs, and the model answers with the fixed verdict object this file writes in the format
// the old session wrote. A refused call (budget, login, broker down) skips the job with its reason (lib/broker-job.mjs): never red, never another provider.
// Job: report health
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {askOrSkip} from './lib/broker-job.mjs';
import {evidenceFor, examEvidence, needEvidence, MAX_NEEDS} from './lib/judge-evidence.mjs';

export const WORDS = ['real', 'false-positive', 'harness', 'needs-human'];
const VERDICT = {type: 'object', additionalProperties: false, required: ['id', 'verdict', 'why', 'check', 'cause', 'severity', 'need'], properties: {
  id: {type: 'string'}, need: {type: 'array', items: {type: 'string'}}, verdict: {type: 'string', enum: WORDS}, why: {type: 'string'}, check: {type: 'string'},
  cause: {type: 'string', enum: ['', 'detector', 'probe-race', 'by-design', 'stale', 'duplicate']}, severity: {type: 'string', enum: ['', 'high', 'medium', 'low']}}};
export const VERDICTS_SCHEMA = {type: 'object', additionalProperties: false, required: ['verdicts'], properties: {verdicts: {type: 'array', items: VERDICT}}};

export const NO_TOOLS = 'THIS CALL HAS NO TOOLS: you cannot open, search or run anything, and the instructions below that say Read, grep, git or "turns" describe a session you are not in. '
  + 'The code the finding points at, the places its words are written and the logs are in the EVIDENCE below, found by a script. Cite only file:line you can see there. '
  + 'When the evidence does not settle it, answer needs-human and say in "check" what a person should open. Fill every field of the answer; use "" for cause, severity or check when the instructions do not ask for it. '
  + 'The word to give is `verdict`; its reasons go in `why`, with the file:line. '
  + `When one more look at named code would settle a finding, answer needs-human and list in \`need\` up to ${MAX_NEEDS} function names, selectors, ids or repo paths (path or path:line): a script fetches where each is declared and used and asks you once more. Use [] when you can answer now.`;
export const FINAL_ROUND = 'THIS IS THE LAST ROUND: the EVIDENCE now includes what you asked for. You cannot ask again: `need` must be []. Answer from what you see; needs-human only when the evidence still cannot settle it.\n\n';

const PICTURE = file => ({type: 'image', source: {type: 'base64', media_type: 'image/png', data: fs.readFileSync(file).toString('base64')}});

/** One verdict object -> the text the old session wrote (word, then Why / Check / Cause / Severity lines), which verdict-comment.mjs parse() and checkEvidence() read. */
export function renderVerdict(v) {
  const word = WORDS.includes(v.verdict) ? v.verdict : 'needs-human';
  return [word, `Why: ${String(v.why || '').trim()}`, ...(String(v.check || '').trim() ? [`Check: ${String(v.check).trim()}`] : []),
    ...(word === 'false-positive' && v.cause ? [`Cause: ${v.cause}`] : []), ...((word === 'real' || word === 'needs-human') && v.severity ? [`Severity: ${v.severity}`] : [])].join('\n');
}

/** verdict mode: the one verdict file; prejudge and exam: `## <id>` sections in the order asked, only for ids the answer gave and the run asked for. */
export function verdictFile(mode, verdicts, ids = []) {
  if (mode === 'verdict') { if (!verdicts.length) throw new Error('the broker answered no verdict'); return `${renderVerdict(verdicts[0])}\n`; }
  return verdicts.filter(v => ids.includes(v.id)).map(v => `## ${v.id}\n${renderVerdict(v)}`).join('\n\n') + '\n';
}

/** The Messages body of a run. Takes {mode, prompt, items: [{id, text, logs, screenshot, evidence?}], root}; returns {body, ids}. */
export function requestFor({mode, prompt, items, root = '.', budget = 90000, final = false}) {
  const per = Math.floor(budget / Math.max(1, items.length));
  const blocks = items.map(item => `##### EVIDENCE for ${mode === 'verdict' ? 'the finding' : item.id}\n${item.evidence ?? (evidenceFor({text: item.text, logs: item.logs, root, budget: per}) || 'none found by the script')}`);
  const shots = items.filter(item => item.screenshot && fs.existsSync(item.screenshot));
  const note = shots.length ? `\n\nScreenshots attached, in this order: ${shots.map(item => (mode === 'verdict' ? 'the finding' : item.id)).join(', ')}.` : '';
  const content = [{type: 'text', text: `${blocks.join('\n\n')}${note}`}, ...shots.map(item => PICTURE(item.screenshot))];
  return {ids: items.map(item => item.id), body: {model: 'claude-sonnet-5-5', max_tokens: 8000, system: `${final ? FINAL_ROUND : ''}${NO_TOOLS}\n\n${prompt}`, messages: [{role: 'user', content}], output_config: {format: {type: 'json_schema', schema: VERDICTS_SCHEMA}}}};
}

const FINDING_AT = '\n---\nTHE FINDING';
function itemsOf(mode, heal) {
  const read = file => fs.readFileSync(path.join(heal, file), 'utf8');
  if (mode === 'verdict') {
    const prompt = read('prompt.md'), at = prompt.indexOf(FINDING_AT);
    const candidate = JSON.parse(read('candidate.json'));
    return {prompt, items: [{id: String(candidate.number), text: at >= 0 ? prompt.slice(at) : prompt, logs: [], screenshot: path.join(heal, 'screenshot.png')}]};
  }
  const pending = JSON.parse(read('pending.json'));
  const prompt = read(mode === 'exam' ? 'exam-prompt.md' : 'prejudge-prompt.md');
  return {prompt, items: pending.map(item => ({id: item.id, text: `${item.title}\n${item.detail}\n${item.impact || ''}`, logs: item.logs || [], screenshot: item.screenshot || '',
    ...(mode === 'exam' ? {evidence: examEvidence(path.join(heal, 'exam', item.id, 'code'))} : {})}))};
}

/**
 * The second round (owner, 31 Oct 2026: "Merge #2708 + measured 2nd round"): the findings whose verdict is needs-human with a non-empty `need` get that code fetched (lib/judge-evidence.mjs needEvidence) and one more broker call
 * with the first evidence plus it. At most 2 calls a finding. Takes {mode, prompt, items, verdicts, root, ask}; returns {verdicts, asked: number of findings asked again, skipped: why or ''}. A refusal in the second round keeps
 * the first round's verdicts (they are real answers) and never marks the job skipped.
 */
export async function secondRound({mode, prompt, items, verdicts, root = '.', ask = askOrSkip}) {
  const wanting = items.map((item, at) => ({item, at, verdict: mode === 'verdict' ? verdicts[0] : verdicts.find(v => v.id === item.id)}))
    .filter(({verdict}) => verdict && verdict.verdict === 'needs-human' && Array.isArray(verdict.need) && verdict.need.some(name => String(name).trim()));
  if (!wanting.length) return {verdicts, asked: 0, skipped: ''};
  const again = wanting.map(({item, verdict}) => ({...item, evidence: `${item.evidence}\n\n##### ASKED FOR BY YOU, FETCHED BY A SCRIPT\n${needEvidence(verdict.need, {root}) || 'nothing found for the names you listed'}`}));
  const {body} = requestFor({mode, prompt, items: again, root, final: true});
  const answer = await ask(body, {job: `judge ${mode} (second round)`, env: {...process.env, GITHUB_OUTPUT: ''}});   // no skipped=true: the first round's verdicts stand
  if (!answer.ok) return {verdicts, asked: 0, skipped: answer.why};
  const second = JSON.parse(answer.text).verdicts;
  const merged = mode === 'verdict' ? (second[0] ? [second[0]] : verdicts) : verdicts.map(v => second.find(w => w.id === v.id && wanting.some(({item}) => item.id === v.id)) || v);
  return {verdicts: merged, asked: wanting.length, skipped: ''};
}

async function main() {
  const args = process.argv.slice(2), at = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : '');
  const mode = at('--mode'), heal = at('--heal') || '.heal';
  if (!['verdict', 'prejudge', 'exam'].includes(mode)) throw new Error('--mode must be verdict, prejudge or exam');
  const {prompt, items} = itemsOf(mode, heal);
  const root = '.';
  const withEvidence = items.map(item => ({...item, evidence: item.evidence ?? (evidenceFor({text: item.text, logs: item.logs, root, budget: Math.floor(90000 / Math.max(1, items.length))}) || 'none found by the script')}));
  const {body, ids} = requestFor({mode, prompt, items: withEvidence});
  const answer = await askOrSkip(body, {job: `judge ${mode}`});
  if (!answer.ok) return;
  const out = path.join(heal, mode === 'verdict' ? 'verdict.md' : 'verdicts.md');
  const first = JSON.parse(answer.text).verdicts;
  const {verdicts, asked, skipped} = await secondRound({mode, prompt, items: withEvidence, verdicts: first, root});
  fs.writeFileSync(out, verdictFile(mode, verdicts, ids));
  console.log(`judge (${mode}): ${verdicts.length} verdict(s) for ${ids.length} finding(s) written to ${out} by ${answer.model || answer.tier} on the Codex plan; second round: ${asked} finding(s) asked again${skipped ? ` (refused: ${skipped}; first answers kept)` : ''}; needs-human ${first.filter(v => v.verdict === 'needs-human').length} -> ${verdicts.filter(v => v.verdict === 'needs-human').length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::judge on Codex: ${error.message}`); process.exit(1); });
