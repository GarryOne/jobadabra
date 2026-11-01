// Each AI answer call for a form (app-core/src/extension.js answerForm -> env.onAnswer trace), summed per engine for the site's per-AI-family
// metrics (owner, 9 Oct 2026: compare the AI itself, Claude vs OpenAI, not the user mix). Counts only: never a field id, a label or an answer.
// Pure: the site imports the lists to validate what it stores (site/src/knowledge.js). Guarded by desktop/test/answer-counts.test.js.

export const ANSWER_ENGINES = ['api', 'cli', 'openai', 'codex'];
export const ANSWER_COUNTS = ['calls', 'fields', 'returned', 'kept', 'empty', 'unknown', 'proposed', 'cut'];
// How long a call took, in buckets (seconds, upper bounds; the last is "more"): the median is read from them.
export const MS_BUCKETS = [5, 10, 20, 40, 80];

const count = value => Math.max(0, Math.min(500, Math.round(Number(value)) || 0));
export const blankAnswers = engine => ({engine, ...Object.fromEntries(ANSWER_COUNTS.map(key => [key, 0])), ms: Array(MS_BUCKETS.length + 1).fill(0)});

// trace -> the entry of its engine in `map` updated; an unknown engine is dropped.
export function addAnswer(map, trace) {
  const engine = String(trace?.engine || '');
  if (!ANSWER_ENGINES.includes(engine)) return false;
  const entry = map.get(engine) || blankAnswers(engine);
  entry.calls++;
  for (const key of ['fields', 'returned', 'kept', 'empty', 'proposed']) entry[key] += count(trace[key]);
  entry.unknown += Array.isArray(trace.unknownIds) ? Math.min(10, trace.unknownIds.length) : 0;   // the ids themselves are never sent
  if (['max_tokens', 'length'].includes(String(trace.stop || ''))) entry.cut++;   // the answer was cut off at the token limit
  const seconds = (Number(trace.ms) || 0) / 1000, bucket = MS_BUCKETS.findIndex(edge => seconds <= edge);
  entry.ms[bucket === -1 ? MS_BUCKETS.length : bucket]++;
  map.set(engine, entry);
  return true;
}

// A failed send: put what was taken back into what came in meanwhile.
export function mergeAnswers(map, taken) {
  for (const [engine, entry] of taken) {
    const again = map.get(engine) || blankAnswers(engine);
    for (const key of ANSWER_COUNTS) again[key] += entry[key];
    entry.ms.forEach((n, i) => { again.ms[i] += n; });
    map.set(engine, again);
  }
}
