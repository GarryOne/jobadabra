// Keeps what a fill replay (replay-net.mjs --fill-memo) added to a recording's model answers: the new keys of the replay's memo are merged into the record's own
// model-memo.json, never a changed or removed one, and the network record beside it is never written. Guard: e2e/test/filling/fill-memo.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const isAnswer = key => !key.includes('#');   // "<key>#parts", "#lines", "#ms", "#layout": the answer's own notes

// -> the answers' keys that are in `after` and not in `before`
export const filledKeys = (before, after) => Object.keys(after).filter(key => isAnswer(key) && !(key in before));

// Merges into <recordDir>/model-memo.json the new answers of <outDir>/model-memo.json, each with its notes (#parts, #lines, #ms, #layout, #volatile). -> the new answers' keys
export function keepFilled(recordDir, outDir) {
  const file = path.join(recordDir, 'model-memo.json'), before = read(file), after = read(path.join(outDir, 'model-memo.json')), fresh = filledKeys(before, after);
  if (!fresh.length) return [];
  const notes = Object.keys(after).filter(key => fresh.some(one => key === one || key.startsWith(`${one}#`)) || (key.endsWith('#layout') && fresh.includes(after[key])));
  const merged = {...before};
  for (const key of [...fresh, ...notes]) merged[key] = after[key];
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged));
  fs.renameSync(tmp, file);
  return fresh;
}

// -> the old answers' keys that are missing or changed in `after` (a fill only adds: always [])
export const oldKeysKept = (before, after) => Object.keys(before).filter(key => JSON.stringify(after[key]) !== JSON.stringify(before[key]));
