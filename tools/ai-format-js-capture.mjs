// Capture desktop AI requests through real sender functions with inert dependencies and fictional memory storage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

const ALLOWED = new Set([
  'desktop/lib/profile-move.js', 'desktop/lib/profile-sections.js', 'desktop/lib/answer-clarity.js',
  'desktop/lib/contact-review.js', 'desktop/lib/contact.js', 'desktop/lib/queue-wording.js',
  'desktop/lib/missing-facts.js', 'desktop/lib/fact-catalog.js', 'desktop/lib/question-reuse.js',
  'desktop/lib/question-formats.js', 'desktop/lib/contact-from-cv.js', 'desktop/lib/cv-queue.js',
  'desktop/lib/cv-check.js', 'desktop/lib/in-flight.js', 'desktop/lib/ai/models.js', 'desktop/lib/ai/names.js',
  'desktop/renderer/question-kind.js', 'desktop/renderer/question-filter.js',
  'desktop/renderer/question-values.js', 'desktop/renderer/work-eligibility.js', 'desktop/renderer/countries.js',
]);
const deny = name => () => { throw new Error(`Offline capture forbids ${name}`); };
const blocked = name => new Proxy({}, {get: (_target, key) => deny(`${name}.${String(key)}`)});
const clone = value => JSON.parse(JSON.stringify(value));

function loader(root, cv) {
  const modules = new Map();
  const memoryFs = {readFileSync: filename => {
    if (filename !== '/fixture/cv.pdf') throw new Error(`Not the fictional CV: ${filename}`);
    return cv;
  }};
  function load(file) {
    if (!ALLOWED.has(file)) return blocked(file);
    if (modules.has(file)) return modules.get(file);
    const exports = {}, names = new Set();
    modules.set(file, exports);
    const original = fs.readFileSync(path.join(root, file), 'utf8');
    // Why (30 Oct 2026, ap): evaluate the whole sender, but never import stores, SDKs, credential readers or host helpers.
    const source = original.replace(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];[^\n]*/gm, (_all, bindings, specifier) => {
      const spec = JSON.stringify(specifier);
      if (bindings.startsWith('* as ')) return `const ${bindings.slice(5)} = dependency(${spec});`;
      if (bindings.startsWith('{')) return `const ${bindings.replace(/\bas\b/g, ':')} = dependency(${spec});`;
      return `const ${bindings} = dependency(${spec});`;
    }).replace(/^export\s*\{([^}]+)\};?/gm, (_all, list) => {
      for (const name of list.split(',').map(name => name.trim())) names.add(name);
      return '';
    }).replace(/^export\s+(?=(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+))/gm, (_all, fn, value) => {
      names.add(fn || value);
      return '';
    });
    const dependency = spec => {
      if (spec === 'node:fs') return memoryFs;
      if (spec === 'node:path') return path;
      if (spec === 'node:crypto') return crypto;
      if (!spec.startsWith('.')) return blocked(spec);
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
    };
    const context = vm.createContext({dependency, Buffer, structuredClone, process: {env: {}}, console: {log: deny('console.log')}});
    const result = vm.runInContext(`${source}\n;({${[...names].join(',')}})`, context, {filename: file, timeout: 3000});
    Object.assign(exports, result);
    return exports;
  }
  return load;
}

function storage() {
  let settings = {};
  const files = new Map();
  return {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; },
    readText: name => files.get(name) || '', writeText: (name, value) => files.set(name, value),
    path: name => { if (name !== 'cv.pdf') throw new Error(`Unexpected fixture path ${name}`); return '/fixture/cv.pdf'; }};
}

function location(root, file, needle) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
  const line = lines.findIndex(text => text.includes(needle));
  if (line < 0) throw new Error(`${file}: missing source marker ${needle}`);
  return `${file}:${line + 1}`;
}

/** Run each desktop sender once against a one-response client; return exact bodies and their parser context. */
export async function captureDesktop(root) {
  const rawCv = fs.readFileSync(path.join(root, 'desktop/e2e/fixtures/cv.pdf'));
  // Why (30 Oct 2026, ap): the existing fictional CV uses example.test; an equal-length example.com address preserves every PDF byte offset.
  const cv = Buffer.from(rawCv.toString('latin1').replace('alex.example@example.test', 'alex.examplea@example.com'), 'latin1');
  if (cv.length !== rawCv.length || !cv.includes(Buffer.from('alex.examplea@example.com'))) throw new Error('Fictional CV contact changed');
  const load = loader(root, cv), entries = [];
  async function capture(kind, context, sender, senderMarker, validator, validatorMarker, run) {
    let request = null, action = '', calls = 0;
    const client = {messages: {create: async (body, options) => {
      if (++calls !== 1) throw new Error(`${kind}: more than one request`);
      request = clone(body);
      action = options?.headers?.['x-jp-action'] || '';
      return {stop_reason: 'end_turn', content: [{type: 'text', text: '{}'}], usage: {input_tokens: 0, output_tokens: 0}};
    }}};
    await run(client);
    if (calls !== 1 || !request || action !== kind) throw new Error(`${kind}: sender did not capture exactly one labelled request`);
    entries.push({kind, action, request, context, source: location(root, sender, senderMarker),
      validator: location(root, validator, validatorMarker), tier: /haiku/.test(request.model) ? 'small' : /opus/.test(request.model) ? 'large' : 'mid'});
  }
  const profile = load('desktop/lib/profile-move.js');
  const items = [{id: 'profile:1', label: 'Notice', value: '2 months'}];
  for (const kind of ['answer_home', 'organize_lines']) {
    const destinations = kind === 'organize_lines' ? [{id: 'availability', page: 'profile', heading: 'Availability', path: []}] : null;
    await capture(kind, {items, destinations}, 'desktop/lib/profile-move.js', 'const response = await ai.messages.create',
      'desktop/lib/profile-move.js', 'const text = response.content', client => profile.judge(items, {client}, {destinations}));
  }
  await capture('contact_asks', {keys: ['first_name'], rated: true, have: [], language: ''}, 'desktop/lib/queue-wording.js', 'const response = await client.messages.create',
    'desktop/lib/queue-wording.js', 'const clean =', client => load('desktop/lib/contact-review.js').wordsFor(storage(), ['first_name'], {client}));
  const missing = load('desktop/lib/missing-facts.js'), catalog = missing.CATALOG;
  await capture('missing_facts_wording', {fields: catalog, keys: catalog.map(fact => fact.id), rated: false, language: ''}, 'desktop/lib/queue-wording.js', 'const response = await client.messages.create',
    'desktop/lib/queue-wording.js', 'const clean =', client => missing.wording(storage(), {client}));
  await capture('covered_facts', {labels: ['Citizenship'], open: catalog}, 'desktop/lib/missing-facts.js', 'const response = await client.messages.create',
    'desktop/lib/missing-facts.js', 'const ids = (JSON.parse', client => missing.covered(storage(), ['Citizenship'], {ai: {client}}));
  const labels = ['Notice period', 'Why Colonist?', 'Earliest start?'], answered = [{question: 'Notice period / earliest start', answer: '3 months'}];
  await capture('reuse_verdict', {labels, answered, facts: [], company: '', host: ''}, 'desktop/lib/question-reuse.js', 'const response = await ai.messages.create',
    'desktop/lib/question-reuse.js', 'let verdicts =', client => load('desktop/lib/question-reuse.js').classify({labels, answered, client}));
  const questions = ['Title', 'Country/Region of Residence', 'Why us?'];
  await capture('question_formats', {asked: questions, allow: []}, 'desktop/lib/question-formats.js', 'const response = await client.messages.create',
    'desktop/lib/question-formats.js', 'export function judged', client => load('desktop/lib/question-formats.js').ensure(storage(), questions, {ai: {client}}));
  const cvContext = {fixture: 'desktop/e2e/fixtures/cv.pdf', sha256: crypto.createHash('sha256').update(cv).digest('hex')};
  await capture('contact_from_cv', {...cvContext, wanted: ['first_name', 'last_name'], profile: ''}, 'desktop/lib/contact-from-cv.js', 'const response = await client.messages.create',
    'desktop/lib/contact-from-cv.js', 'export function cleanProposals', client => load('desktop/lib/contact-from-cv.js').propose(client, cv, ['first_name', 'last_name']));
  await capture('cv_queue', {...cvContext, wanted: ['languages'], catalog}, 'desktop/lib/cv-queue.js', 'const response = await client.messages.create',
    'desktop/lib/cv-queue.js', 'const clean =', client => load('desktop/lib/cv-queue.js').factProposals(storage(), {client, wanted: ['languages']}));
  return clone(entries);
}
