// Enumerate jobs feed variations and require every reachable backbone question to have a stored answer.
// Job: serve stored answers
// Invariants: postings come from suite inputs, not a copied title list; historical refusals remain portable on CI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {answerFor, loadTable, questionOf} from '../lib/ai-answers.mjs';
import {hash} from '../lib/ai-answers-engine-items.mjs';
import {MATCHES, DECOYS, ZURICH, SHAPES, varyFeeds} from '../lib/feeds.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const asks = read('golden/jobs-asks.json');
// Exact distinct question.items from jobs-2574, jobs-2574b and jobs-c (owner-supplied refusal artifacts).
// Keep this evidence here: CI must not depend on the owner's /private/tmp files surviving.
const refused = [
  ["app.enrich", "default/app.enrich/2539c39dd2899709c97dbfd18bd09c279c43aecb64a2a8c0b78b8c3d4355d1a3/full", "Staff Platform Engineer\nE2E Gamma\nZurich, Switzerland"],
  ["app.enrich", "default/app.enrich/2539c39dd2899709c97dbfd18bd09c279c43aecb64a2a8c0b78b8c3d4355d1a3/role", "Staff Platform Engineer\nE2E Gamma\nZurich, Switzerland"],
  ["app.enrich", "default/app.enrich/4073bfb2f2a8ec66cee4f7ad4109b61971f64cd144a6907dec365775f259bab7/full", "DevOps Engineer, CI/CD\nE2E Acme\nZurich, ZH, Switzerland"],
  ["app.enrich", "default/app.enrich/573b5005fb7a6577a2583da5bd83b0e57189eaf5513dd166c27be068361d64a7/full", "Senior DevOps Engineer\nE2E Gamma\nZurich, Switzerland"],
  ["app.enrich", "default/app.enrich/573b5005fb7a6577a2583da5bd83b0e57189eaf5513dd166c27be068361d64a7/role", "Senior DevOps Engineer\nE2E Gamma\nZurich, Switzerland"],
  ["app.enrich", "default/app.enrich/62d930cb9fcde50901ab878f965e4190fe86e9ded26266d6881f7d19c85e40c7/full", "Platform Engineer, Kubernetes\nE2E Acme\nZurich, ZH, Switzerland"],
  ["app.enrich", "default/app.enrich/78995bbbcd207da2629c4ac67e65ed0f93c39a3e1a18215d854fbddade65efb8/full", "Site Reliability Engineer, Storage\nE2E Acme\nZurich"],
  ["app.enrich", "default/app.enrich/b060cb13026d8e74989f5b4ab991ac20d8e25e03401e7bd2e431a68bc94862d4/full", "Senior Site Reliability Engineer\nE2E Acme\nZurich"],
  ["app.enrich", "default/app.enrich/bbd0aff9c2c8048bc4ab1dbac021f4d2a91333a14cf3a739b8d2230e9412a4d5/full", "Staff Site Reliability Engineer\nE2E Acme\nZurich, Switzerland"],
  ["app.enrich", "default/app.enrich/ec99a244f1d8b32f294e42268f775fe778ffba257bd20860291d0b8dde28b3cd/full", "Platform Engineer, Kubernetes\nE2E Acme\nZurich"],
  ["app.enrich", "default/app.enrich/ecc5dfe03bfd88ab6d96bc78d75534aa9e9de0e7ad2d53930aa9d3dfb851dc90/full", "Senior Site Reliability Engineer\nE2E Acme\nZurich, ZH, Switzerland"],
  ["app.place", "default/places-289aa37c5864/05406c552c70ee3eac5b06e3a9b5792afdc8ab7c78c6196b13de11f70ba9d2b0", "zurich, zh, switzerland"],
  ["app.place", "default/places-289aa37c5864/0777b545c12b1a54ed07b977da9e8d7e2f6e9223e5abb7dcec678b169bb5aa4e", "zurich, switzerland"],
  ["app.place", "default/places-289aa37c5864/811dae26155c1f96fa4be679ba416b5b956c4eb73dc831d69f61692507e30595", "zurich"],
  ["app.place", "default/places-289aa37c5864/f037a09517904cd7e48604a0e978aeae9e09f1218a46b3efe90725beb3f0ff4b", "remote - europe"],
];

function rememberPosting(postings, title, company, location) {
  const posting = Object.fromEntries(Object.entries({title, company, location}).map(([key, value]) => [key, value.trim()]));
  postings.set(hash(posting), posting);
}

function addFeed(postings, source, data) {
  for (const job of data.jobs) rememberPosting(postings, job.title, source.company || source.name, job.location.name);
}

function* feedVariations() {
  for (const place of ZURICH) for (const match of MATCHES) for (const decoy of DECOYS) for (const shape of SHAPES) {
    yield new Map([[ZURICH, place], [MATCHES, match], [DECOYS, decoy], [SHAPES, shape]]);
  }
}

function addVariedPostings(t, postings, sources, feed) {
  // Exercise the real variation helper, including its crowd generator and the unchanged Beta locations.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-feed-coverage-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const choices of feedVariations()) {
    for (const source of sources) fs.copyFileSync(new URL(`../fixtures/feeds/${feed(source)}`, import.meta.url), path.join(dir, feed(source)));
    varyFeeds(dir, {fixed: false, pick: values => choices.get(values), shuffle: values => values});
    for (const source of sources) addFeed(postings, source, JSON.parse(fs.readFileSync(path.join(dir, feed(source)), 'utf8')));
  }
}

function addSlowPostings(postings, company) {
  // The slow-check titles live in the suite itself. Read its literal rather than maintaining a second list.
  const suite = fs.readFileSync(new URL('../suites/jobs.mjs', import.meta.url), 'utf8');
  const slow = /const more = (\[[^\n]+\]);/.exec(suite);
  assert.ok(slow, 'jobs slow-check posting fixture must remain enumerable');
  const slowTitles = vm.runInNewContext(slow[1]);
  const slowPlace = /more\.forEach[\s\S]*?location: \{name: '([^']+)'\}/.exec(suite);
  assert.ok(slowPlace, 'jobs slow-check location must remain enumerable');
  for (const title of slowTitles) rememberPosting(postings, title, company, slowPlace[1]);
}

function enumeratePostings(t) {
  const postings = new Map(), sources = read('feeds/sources.json');
  const scouts = read('feeds/scout_seeds.json').tier1_known;
  const routes = read('feeds/routes.json');
  const feed = source => routes[`/boards/${source.slug}/jobs`];
  for (const source of [...sources, ...scouts]) addFeed(postings, source, read(`feeds/${feed(source)}`));
  addVariedPostings(t, postings, sources, feed);
  addSlowPostings(postings, sources[0].company);
  return postings;
}

function itemChecker(table, missing) {
  return (operation, key, text) => {
    const entry = table.items[operation]?.[key];
    if (!entry || entry.text !== text) missing.add(`${operation}/${key} ${JSON.stringify(text)}`);
    return entry;
  };
}

function templatesFor(questions) {
  const title = asks.requests.find((_row, index) => questions[index].operation === 'app.title');
  const titleHeader = title.body.messages[0].content.split('The titles:\n')[0];
  const search = JSON.parse(titleHeader.slice('The search (JSON): '.length).trim());
  const draft = JSON.parse(fs.readFileSync(new URL('../../demo/draft.json', import.meta.url), 'utf8')).draft;
  assert.deepEqual(search.role_words, draft.search.target_roles.map(title => title.toLowerCase()), 'title context follows the seeded search');
  assert.deepEqual(search.words_ruled_out, draft.search.title_exclude_keywords);
  const score = asks.requests.find((_row, index) => questions[index].operation === 'app.score');
  const enrich = ['full', 'role'].map(form => asks.requests.find((_row, index) => questions[index].operation === 'app.enrich' && questions[index].items[0].key.endsWith(`/${form}`)));
  return {title, titleHeader, score, enrich};
}

function selectPostings(postings, {title, titleHeader}, requireItem) {
  const selected = new Map();
  for (const [id, posting] of postings) {
    const body = {...title.body, messages: [{role: 'user', content: `${titleHeader}The titles:\n1. ${posting.title.toLowerCase()}`}]};
    const question = questionOf({body}, {});
    assert.equal(question.operation, 'app.title', question.unkeyable);
    const item = question.items[0], entry = requireItem(question.operation, item.key, item.text);
    if (entry?.answer === true) selected.set(id, posting);
  }
  const scorePostings = new Map(asks.scorePostings.map(({id, ...posting}) => {
    assert.equal(id, `feed/${hash(posting)}`, 'declared score id follows the posting tuple');
    return [hash(posting), posting];
  }));
  // This also catches a feed addition or changed location that the authored score catalog has not followed.
  assert.deepEqual([...selected.keys()].sort(), [...scorePostings.keys()].sort(), 'score catalog must cover exactly the selected fixture postings');
  return selected;
}

function postingQuestion(template, posting) {
  return questionOf({body: {...template.body, messages: [{role: 'user',
    content: `Title: ${posting.title}\nCompany: ${posting.company}\nLocation: ${posting.location}\n\nPosting:\nFixture posting.`}]}}, {});
}

function checkOneTuple(id, posting, templates, table, missing, requireItem) {
  const score = postingQuestion(templates.score, posting);
  assert.equal(score.id, `feed/${id}`, score.unkeyable || 'score identity follows the feed tuple');
  if (!answerFor(score, table).reply) missing.add(`app.score/${score.id}`);
  for (const template of templates.enrich) {
    const question = postingQuestion(template, posting);
    assert.equal(question.operation, 'app.enrich', question.unkeyable);
    for (const item of question.items) requireItem(question.operation, item.key, item.text);
    const result = answerFor(question, table);
    if (!result.reply) missing.add(result.missing || result.unkeyable);
  }
}

function enumerateLocations(postings) {
  return new Set([...postings.values()].map(posting => posting.location.toLowerCase()));
}

function enumeratePlaceContexts(questions) {
  const contexts = new Set();
  for (const question of questions.filter(question => question.operation === 'app.place')) {
    for (const item of question.items) contexts.add(item.key.split('/')[1]);
  }
  for (const [operation, key] of refused) if (operation === 'app.place') contexts.add(key.split('/')[1]);
  return contexts;
}

function checkPlacesAndRefusals(locations, contexts, requireItem) {
  for (const context of contexts) for (const location of locations) requireItem('app.place', `default/${context}/${hash(location)}`, location);
  for (const [operation, key, text] of refused) requireItem(operation, key, text);
}

function checkDeclaredQuestions(questions, selected, table, missing, requireItem) {
  // Check the other declared engine asks too, and every selected title's independent kind decision.
  const decisions = read('golden/jobs-decide.json').requests.map(row => questionOf({body: row.body}, {}));
  const kind = decisions.find(question => question.context.task.startsWith('A job title,'));
  for (const posting of selected.values()) requireItem('app.decide', `default/${hash(kind.context)}/${hash(posting.title)}`, posting.title);
  for (const question of [...questions, ...decisions]) {
    assert.ok(!question.unkeyable, question.unkeyable);
    if (question.items) for (const item of question.items) requireItem(question.operation, item.key, item.text);
    const result = answerFor(question, table);
    if (!result.reply) missing.add(result.missing || result.unkeyable);
  }
}

test('jobs fixtures cover the whole feed ask set, all forms and search contexts', t => {
  const table = loadTable(), missing = new Set(), postings = enumeratePostings(t);
  const requireItem = itemChecker(table, missing);
  const questions = asks.requests.map(row => questionOf({body: row.body, headers: row.action ? {'x-jp-action': row.action} : {}}, {}));
  const templates = templatesFor(questions);
  const selected = selectPostings(postings, templates, requireItem);
  for (const [id, posting] of selected) checkOneTuple(id, posting, templates, table, missing, requireItem);
  const locations = enumerateLocations(postings), contexts = enumeratePlaceContexts(questions);
  checkPlacesAndRefusals(locations, contexts, requireItem);
  checkDeclaredQuestions(questions, selected, table, missing, requireItem);
  t.diagnostic(`${postings.size} distinct feed postings; ${selected.size} selected × 3 forms; ${locations.size} locations × ${contexts.size} place contexts; ${refused.length} historical keys`);
  t.diagnostic(`Locations: ${[...locations].sort().join('; ')}`);
  assert.deepEqual([...missing].sort(), [], 'missing stored jobs answers (exact keys and texts)');
});
