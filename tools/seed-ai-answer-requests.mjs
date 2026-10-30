// Seed deterministic prompt references from committed captures without copying request bodies.
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTable, questionOf, answerFor} from '../desktop/e2e/lib/ai-answers.mjs';
import {canonical, hash} from '../desktop/e2e/lib/ai-answers-engine-items.mjs';

const GOLDEN = fileURLToPath(new URL('../desktop/e2e/fixtures/golden/', import.meta.url));
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Seed only exact keyed joins; provenance describes the request, never an AI-authored baseline. */
export function seedRequests({golden = GOLDEN, table = loadTable()} = {}) {
  const seeds = [];
  const read = file => JSON.parse(fs.readFileSync(path.join(golden, file), 'utf8'));
  const add = (file, pointer, body, provenance, action = '', evidence = '') => {
    const request = {body, headers: action ? {'x-jp-action': action} : {}};
    const question = questionOf(request, {E2E_AI_ANSWERS: 'backbone'}, table);
    if (question.unkeyable || question.operation === 'app.kind') return;
    const keys = question.items ? question.items.filter(item => {
      const entry = table.items?.[question.operation]?.[item.key];
      return entry?.text === item.text && !!answerFor({...question, items: [item]}, table).reply;
    }).map(item => item.key) : answerFor(question, table).reply ? [question.id] : [];
    if (!keys.length) return;
    const sha256 = hash(canonical(body));
    seeds.push({id: hash(canonical({sha256, kind: question.operation})), kind: question.operation,
      source: {file, path: pointer, sha256}, ...(action ? {action} : {}), provenance,
      ...(evidence ? {evidence} : {}), keys: [...new Set(keys)].sort(cmp)});
  };
  for (const file of ['jobs-asks.json', 'jobs-decide.json']) {
    read(file).requests.forEach((entry, index) => add(file, ['requests', index, 'body'], entry.body,
      entry.provenance.startsWith('reconstructed') ? 'reconstructed' : 'captured', '', entry.provenance));
  }
  const activity = read('activityfailures-decide.json');
  add('activityfailures-decide.json', ['request'], activity.request, 'captured', '', activity.about);
  activity.requests.forEach((body, index) => add('activityfailures-decide.json', ['requests', index], body, 'reconstructed', '', activity.about));
  const interviews = read('interviews-decide.json');
  interviews.requests.forEach((body, index) => add('interviews-decide.json', ['requests', index], body, 'reconstructed', '', interviews.about));
  const failures = read('failuresnotion-asks.json');
  failures.asks.forEach((entry, index) => add('failuresnotion-asks.json', ['asks', index, 'request'], entry.request, 'captured', entry.action, failures.about));
  for (const file of ['wander-decide.json', 'calendar-asks.json', 'storemove-organize-ask.json']) {
    const entry = read(file);
    add(file, ['request'], entry.request, 'captured', entry.action || (file === 'storemove-organize-ask.json' ? 'organize_lines' : ''), entry.about);
  }
  read('ai-format-manifest.json').entries.forEach((entry, index) => add('ai-format-manifest.json', ['entries', index, 'request'], entry.request, 'sender capture', entry.action, entry.source));
  // Invariants: an identical prompt/kind appears once; the earliest captured source wins over reconstruction/sender evidence.
  const rank = {'captured': 0, reconstructed: 1, 'sender capture': 2};
  seeds.sort((a, b) => rank[a.provenance] - rank[b.provenance] || cmp(a.source.file, b.source.file) || cmp(canonical(a.source.path), canonical(b.source.path)));
  return [...new Map(seeds.reverse().map(entry => [entry.id, entry])).values()].sort((a, b) => cmp(a.kind, b.kind) || cmp(a.id, b.id));
}

/** Serialize a JSON array with one prompt reference per line for independent fixture additions. */
export const serializeRequests = entries => `[\n${entries.map(entry => `  ${JSON.stringify(entry)}`).join(',\n')}\n]\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(GOLDEN, 'ai-answer-requests.json');
  const entries = seedRequests();
  fs.writeFileSync(file, serializeRequests(entries));
  console.log(`${entries.length} prompt references written to ${file}`);
}
