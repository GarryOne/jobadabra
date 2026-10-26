// The screenshot review's memory (lib/review-cache.mjs): a same-looking shot of the same question gets the last answer; a changed look, prompt or fact is asked again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {buildRequest} from '../lib/vision.mjs';
import {CACHE_DAYS, prune, questionKey, recall, remember} from '../lib/review-cache.mjs';

const strips = fill => ({width: 32, height: 40, cols: 2, cells: Buffer.alloc(2 * 40 * 3, fill)});   // 80 cells: all of them changed is a changed page
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'review-cache-'));

test('the same look of the same question is answered from memory; another look is not', () => {
  const at = dir(), key = questionKey('focus', buildRequest({view: 'focus', pngBase64: 'AAAA', facts: {page: 'focus'}}));
  assert.equal(recall(at, key, strips(200)), null, 'nothing judged yet');
  remember(at, key, {view: 'focus', model: 'm', strips: strips(200), text: '{"findings":[]}'});
  assert.equal(recall(at, key, strips(200)), '{"findings":[]}');
  assert.equal(recall(at, key, strips(100)), null, 'the page changed: ask again');
  fs.writeFileSync(path.join(at, `look-${key}.json`), '{broken');
  assert.equal(recall(at, key, strips(200)), null, 'an unreadable memory is asked again');
});

test('the question key ignores the picture but not the prompt, the facts or the lessons', () => {
  const key = extra => questionKey('focus', buildRequest({view: 'focus', pngBase64: 'AAAA', facts: {page: 'focus'}, ...extra}));
  assert.equal(key({pngBase64: 'BBBB'}), key({}));
  assert.notEqual(key({facts: {page: 'focus', jobsInList: 2}}), key({}));
  assert.notEqual(key({lessons: 'Already judged BY DESIGN: x'}), key({}));
  assert.notEqual(key({model: 'other'}), key({}));
});

test('an answer not used for CACHE_DAYS is pruned', () => {
  const at = dir();
  remember(at, 'old', {view: 'v', model: 'm', strips: strips(1), text: 't'});
  prune(at, {now: Date.now() + (CACHE_DAYS + 1) * 86400000});
  assert.deepEqual(fs.readdirSync(at), []);
});
