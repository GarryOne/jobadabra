// The golden sets of the quality suite (fixtures/golden for the SRE, fixtures/golden-photographer): a truth that does not match its own postings would make the suite
// fail (or pass) for the wrong reason, after minutes and real AI money. Checked here, in milliseconds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {normalizeUrl, rankingViolations} from '../../lib/quality.mjs';

const FIXTURES = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..', 'fixtures');
const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(FIXTURES, dir, file), 'utf8'));
const money = text => String(text).replace(/(\d)[,'’.](?=\d{3}\b)/g, '$1');

for (const dir of ['golden', 'golden-photographer']) {
  const truth = read(dir, 'truth.json'), board = read(dir, 'board.json').jobs;

  test(`${dir}: every posting of the board has a truth entry with the same title and address, and a duplicate points at a real one`, () => {
    assert.equal(truth.length, board.length);
    const byId = new Map(truth.map(item => [item.id, item]));
    assert.equal(byId.size, truth.length, 'ids are unique');
    for (const job of board) {
      const item = byId.get(job.id);
      assert.ok(item, `no truth for ${job.id}`);
      assert.equal(item.title, job.title);
      assert.equal(item.url, job.absolute_url);
      if (item.duplicateOf) assert.equal(normalizeUrl(item.url), normalizeUrl(byId.get(item.duplicateOf).url), `${job.id} is a duplicate of ${item.duplicateOf}: the same address once tracking is gone`);
    }
  });

  test(`${dir}: what the truth states is really in the posting`, () => {
    const board_ = new Map(board.map(job => [job.id, job.content.replace(/<[^>]+>/g, '')]));
    for (const item of truth.filter(entry => !entry.duplicateOf)) {
      const text = money(board_.get(item.id));
      assert.equal(item.location, board.find(job => job.id === item.id).location.name, `${item.id}: the place the app must report is the one the board gives`);
      if (Array.isArray(item.salary)) for (const figure of item.salary) assert.ok(text.replace(/\s/g, '').includes(figure) || text.includes(figure), `${item.id}: salary ${figure} is not stated`);
      for (const plus of item.languagePlus || []) assert.match(text, new RegExp(plus.replace(' +', ''), 'i'), `${item.id}: ${plus} is not named`);
      if (item.mustMention) assert.ok(item.fit === 'low', `${item.id}: a blocker belongs to a low-fit posting`);
      assert.ok(['high', 'mid', 'low'].includes(item.fit), `${item.id}: fit`);
    }
  });

  test(`${dir}: there are relevant and irrelevant postings to rank, and a perfect ranking has no violation`, () => {
    const fit = name => truth.filter(item => item.fit === name);
    assert.ok(fit('high').length >= 3 && fit('low').length >= 3);
    const perfect = Object.fromEntries(truth.filter(item => item.fit).map(item => [item.id, {high: 90, mid: 60, low: 30}[item.fit]]));
    assert.deepEqual(rankingViolations(truth, perfect), []);
    assert.equal(rankingViolations(truth, {...perfect, [fit('low')[0].id]: 95}).length, fit('high').length);
  });
}

test('golden-photographer: her profile states her compensation and languages, and her persona data is complete', () => {
  const profile = fs.readFileSync(path.join(FIXTURES, 'golden-photographer', 'profile.md'), 'utf8');
  assert.match(profile, /^- Target: .*CHF 95,000/m);
  assert.match(profile, /^- Minimum acceptable: .*CHF 75,000/m);
  assert.match(profile, /Languages I can work in: English/);
  const persona = read('golden-photographer', 'persona.json');
  const candidate = fs.readFileSync(path.join(FIXTURES, 'golden-photographer', 'candidate.txt'), 'utf8');
  assert.ok(candidate.includes(persona.email), 'her email is in her CV: the privacy check looks for it in the logs');
  for (const term of persona.cvMatch.terms) {
    assert.ok(JSON.stringify(persona.cvMatch.cv).toLowerCase().includes(term), `her CV states ${term}`);
    assert.ok(read('golden-photographer', 'truth.json').some(item => item.fit === 'high' && item.description?.toLowerCase().includes(term)), `a high-fit posting names ${term}`);
  }
  assert.ok(persona.search.role_keywords.length && persona.search.locations.top_tier.length);
});
