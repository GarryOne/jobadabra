// The screenshot review's memory (owner, 26 Oct 2026: review only screenshots whose pixels changed since the last one judged, and keep each verdict):
// one file per page and question (the view, the model, the instructions, the facts and lessons asked with it), holding the last picture judged (as
// lib/png-grid.mjs strips) and its answer. A new shot of that page that looks the same (sameLook) gets that answer back, unasked. Before, the key was the
// request's bytes, picture included: 0 of 29 pages ever hit (19-25 Oct 2026), since a build stamp or a clock is always new. Guarded by test/review-cache.test.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {sameLook, stripsFromJson, stripsToJson} from './png-grid.mjs';

export const CACHE_DAYS = 14;   // an answer older than this is asked again (and the file pruned): the reviewer's judgement may have moved on

// Everything the answer depends on except the picture: change a word of the prompt, a fact or a lesson and the page is asked again.
export function questionKey(view, request) {
  const words = [view, request.model || '', ...(request.system || []).map(block => block.text), ...request.messages[0].content.filter(block => block.type === 'text').map(block => block.text)];
  return crypto.createHash('sha256').update(words.join('\u0000')).digest('hex');
}

export function prune(dir, {now = Date.now()} = {}) {
  fs.mkdirSync(dir, {recursive: true});
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (now - fs.statSync(file).mtimeMs > CACHE_DAYS * 86400000) fs.rmSync(file, {force: true});
  }
}

const fileFor = (dir, key) => path.join(dir, `look-${key}.json`);

// -> the answer given to a same-looking picture of this question, or null. A hit is touched, so a page still in use outlives CACHE_DAYS.
export function recall(dir, key, strips) {
  const file = fileFor(dir, key);
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved.text !== 'string' || !sameLook(stripsFromJson(saved.look), strips)) return null;
    fs.utimesSync(file, new Date(), new Date());
    return saved.text;
  } catch { return null; }
}

export function remember(dir, key, {view, model, strips, text}) {
  fs.writeFileSync(fileFor(dir, key), JSON.stringify({view, model, at: new Date().toISOString(), look: stripsToJson(strips), text}));
}
