// Enforces each suite's committed ceiling for AI asks without a stored answer.
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';

/** Pure verdict: an absent ceiling never fails; diagnostics contain only the request key, never prompt text. */
export function aiMissesVerdict(misses, lane, firstKey = '') {
  const max = lane?.aiMissesMax ?? null;
  const ok = max === null || misses <= max;
  return {ok, misses, max, message: ok ? '' : `AI asks with no stored answer: ${misses} (allowed ${max}); first ask key: ${firstKey}`};
}

/** Count miss JSON filenames without reading bodies; missing folders mean zero, and suites without a ceiling do no I/O. */
export function checkAiMisses(artifacts, lane) {
  if (lane?.aiMissesMax === undefined) return aiMissesVerdict(0, lane);
  const dir = path.join(artifacts, 'ai-misses');
  let files;
  try { files = fs.readdirSync(dir, {withFileTypes: true}).filter(file => file.isFile() && file.name.endsWith('.json')).map(file => file.name).sort(); }
  catch (error) { if (error.code === 'ENOENT') return aiMissesVerdict(0, lane); throw error; }
  return aiMissesVerdict(files.length, lane, files[0]?.slice(0, -5) || '');
}
