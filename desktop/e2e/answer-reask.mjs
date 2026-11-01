// Re-asks a pool day's captured form questions (replay candidates' /extension/answer calls) with the seeded fake applicant, on the plan path ($0):
// how many answers are set from saved facts, proposed, or left, per row and overall. Measures an answer-prompt change on the same questions.
// Usage: node e2e/answer-reask.mjs --day <replay-candidates/<day> dir> --out <file.json> [--only <row>] [--jobs 3] [--worker <a copy's worker/src/extension.js>]
//        node e2e/answer-reask.mjs --compare <before.json> <after.json>
// Reads captures read-only; writes only --out. Never the API key (the app's Claude Code client, lib/ladder-score-path.mjs). The privacy tripwire (lib/privacy-tripwire.mjs) checks every
// answer: the plan's claude -p knows the signed-in account, so an owner value is counted (owner: <kind>) and never written. Guard: test/ai/answer-reask.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cvFactsText} from '../../worker/src/cv-facts.js';
import {scoringClient} from './lib/ladder-score-path.mjs';   // the product's own Claude Code client (native --json-schema), as the ladder score uses
import {applicantDraft} from './lib/applicant-seed.mjs';
import {matchesOwner, ownerValues} from './lib/privacy-tripwire.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// The applicant an ask carries (lib/applicant-seed.mjs applicantDraft: thin, or grown) and the CV fixture: what a live pool row's app holds.
export function applicantEnv(which = undefined, cvFile = path.join(here, 'fixtures', 'cv.json')) {   // JP_APPLICANT=grown, or which: the grown applicant
  const draft = applicantDraft({which});
  return {PROFILE_TEXT: draft.profile_markdown || '', ANSWERS_TEXT: draft.answers_markdown || '', KNOWLEDGE_TEXT: '',
    SEARCH_TEXT: draft.search ? `${JSON.stringify(draft.search, null, 2)}\n` : '', CV_FACTS_TEXT: cvFactsText(JSON.parse(fs.readFileSync(cvFile, 'utf8')))};
}

// Every captured answer ask of a day: [{row, url, fields}].
export function capturedAsks(dayDir, only = '') {
  const asks = [];
  for (const row of fs.readdirSync(dayDir).sort()) {
    if (only && !only.split(',').includes(row)) continue;   // --only a,b
    const file = path.join(dayDir, row, 'ai-calls.json');
    if (!fs.existsSync(file)) continue;
    for (const call of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      if (call.route === '/extension/answer' && call.request?.fields?.length) asks.push({row, url: call.request.url, fields: call.request.fields});
    }
  }
  return asks;
}

// One field's outcome from an answer list: fill (typed), propose, kind (legal/written/demographic/unanswered: a hold), none.
export function outcomeOf(field, answers) {
  const answer = answers.find(a => a.field === field.field);
  if (!answer) return {use: 'none'};
  if (answer.use === 'kind') return {use: 'kind', category: answer.category || 'unanswered'};
  return {use: answer.use === 'propose' ? 'propose' : 'fill', category: answer.category || '', fact: answer.fact || '', confidence: answer.confidence || '', value: String(answer.value ?? '').slice(0, 80)};
}

// The tripwire on one field's outcome: an owner value is blanked, its kind kept (never the value).
export function scrubOwner(outcome, label, values) {
  const hit = outcome.value ? matchesOwner([{label, value: outcome.value}], values)[0] : null;
  return hit ? {...outcome, value: '', owner: hit.kind} : outcome;
}

// Tallies a result file: per row and overall, required fields by outcome.
export function tally(results) {
  const rows = {}, all = {fill: 0, propose: 0, kind: 0, none: 0, error: 0, owner: 0};
  for (const item of results) {
    const row = rows[item.row] ||= {fill: 0, propose: 0, kind: 0, none: 0, error: 0};
    for (const field of item.fields) {
      if (!field.required) continue;
      const use = item.error ? 'error' : field.use;
      row[use]++; all[use]++;
      if (field.owner) all.owner++;
    }
  }
  return {rows, all};
}

// before/after on the same fields: which moved, and whether a hold (kind) changed (it must not).
export function compare(before, after) {
  const key = (item, field) => `${item.row}|${item.url}|${field.field}`;
  const old = new Map(before.flatMap(item => item.fields.map(field => [key(item, field), field])));
  const moves = [], holdsMoved = [];
  for (const item of after) {
    for (const field of item.fields) {
      const was = old.get(key(item, field));
      if (!was || was.use === field.use) continue;
      moves.push({row: item.row, label: field.label, required: field.required, from: was.use, to: field.use, fact: field.fact || '', value: field.value || '', owner: field.owner || ''});
      if (was.use === 'kind' || (field.use === 'fill' && ['legal', 'demographic', 'written'].includes(field.category))) holdsMoved.push(moves.at(-1));
    }
  }
  return {moves, holdsMoved};
}

async function reask({dayDir, out, only, jobs, worker: workerFile}) {
  const {answerForm} = await import(workerFile ? path.resolve(workerFile) : '../../worker/src/extension.js');   // --worker: the same questions to another build (origin/main) for a before/after
  const env = applicantEnv(), client = scoringClient(), owner = ownerValues(), asks = capturedAsks(dayDir, only), results = [];
  let next = 0;
  const worker = async () => {
    while (next < asks.length) {
      const ask = asks[next++];
      const started = Date.now();
      try {
        const answer = await answerForm({...env}, {url: ask.url, fields: ask.fields}, client);
        results.push({row: ask.row, url: ask.url, ms: Date.now() - started, fields: ask.fields.map(f => ({field: f.field, label: String(f.label || '').slice(0, 100), type: f.type, required: !!f.required, ...scrubOwner(outcomeOf(f, answer.answers || []), f.label, owner)}))});
      } catch (error) {
        results.push({row: ask.row, url: ask.url, error: String(error.message || error).slice(0, 200), fields: ask.fields.map(f => ({field: f.field, label: String(f.label || '').slice(0, 100), required: !!f.required, use: 'none'}))});
      }
      console.log(`reask: ${results.length}/${asks.length} ${ask.row} ${results.at(-1).error ? `ERROR ${results.at(-1).error}` : `${Math.round((Date.now() - started) / 1000)}s`}`);
    }
  };
  await Promise.all(Array.from({length: Math.max(1, jobs)}, worker));
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  console.log(`reask: DONE ${JSON.stringify(tally(results).all)} -> ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
  if (args[0] === '--compare') {
    const [before, after] = [args[1], args[2]].map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    const {moves, holdsMoved} = compare(before, after);
    console.log('before', JSON.stringify(tally(before).all), '\nafter ', JSON.stringify(tally(after).all));
    for (const move of moves) console.log(`  ${move.required ? '*' : ' '} ${move.row}: ${move.label.slice(0, 60)} ${move.from} -> ${move.to}${move.fact ? ` (${move.fact})` : ''} ${move.value ? JSON.stringify(move.value) : ''}${move.owner ? ` OWNER VALUE (${move.owner})` : ''}`);
    console.log(`holds moved: ${holdsMoved.length}`);
  } else {
    if (!opt('--day') || !opt('--out')) { console.error('usage: --day <dir> --out <file> [--only <row>] [--jobs 3]'); process.exit(2); }
    await reask({dayDir: opt('--day'), out: opt('--out'), only: opt('--only'), jobs: Number(opt('--jobs') || 3), worker: opt('--worker')});
  }
}
