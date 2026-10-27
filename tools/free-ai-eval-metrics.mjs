// What the Free AI quality table measures (tools/free-ai-eval.mjs): is the answer valid JSON in the asked shape, and does it rank like the baseline.
// Pure functions, tested in desktop/test/free-ai-eval.test.js.

// A small JSON-schema check for the shapes the app asks for (type, enum, required, properties, items): -> [problems].
export function schemaProblems(value, schema, at = '$') {
  const types = [].concat(schema.type || []);
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const ok = !types.length || types.some(type => type === kind || (type === 'number' && kind === 'integer'));
  if (!ok) return [`${at}: ${kind}, wanted ${types.join('|')}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${at}: not one of ${schema.enum.join('/')}`];
  const found = [];
  if (kind === 'object') {
    for (const key of schema.required || []) if (!(key in value)) found.push(`${at}.${key}: missing`);
    for (const [key, sub] of Object.entries(schema.properties || {})) if (key in value) found.push(...schemaProblems(value[key], sub, `${at}.${key}`));
  }
  if (kind === 'array' && schema.items) value.forEach((item, i) => found.push(...schemaProblems(item, schema.items, `${at}[${i}]`)));
  return found;
}

// What a written answer puts in the box: its text before the first "• Add:" reminder (those are shown beside the box, never typed: worker/src/written-answer.js splitReminders, #2198).
const typed = answer => answer?.category === 'written' ? String(answer.value ?? '').split(/\s*•\s*Add:/)[0].trim() : String(answer?.value ?? '');
/**
 * A form-answer reply against what each field should get (the eval cases in tools/free-ai-form-list.mjs).
 * @param {{answers?: Array<{field: string, value?: string, use?: string, category?: string}>}} data the model's parsed reply
 * @param {Record<string, {value?: string[], match?: string, notMatch?: string, empty?: true, maybeEmpty?: true, category?: string, use?: string}>} expect per field id:
 *   acceptable values, a regex the typed text must hold (match) or must not hold (notMatch), empty, category, use
 * @returns {string[]} one line per broken expectation; [] when every field is right. Never throws on a missing or malformed answer (it is a problem line).
 * A written answer is judged on what is typed: its text before the first "• Add:" reminder.
 */
export function answerProblems(data, expect) {
  // What reaches the page: the product floors a proposal on a legal or demographic question to an empty kind (worker/src/extension.js answerForm), an unchecked box is no answer, and a
  // proposal is shown, never typed, so an "empty" expectation only fails on a typed answer. A multi-choice value (" && ") is right when every part is.
  const answers = (Array.isArray(data?.answers) ? data.answers : []).map(a => (a.use === 'propose' && ['legal', 'demographic'].includes(a.category)) || a.value === 'unchecked' ? {...a, value: ''} : a), found = [];
  for (const [field, want] of Object.entries(expect)) {
    const got = answers.find(answer => answer.field === field);
    const given = got && String(got.value ?? '') !== '';
    const parts = String(got?.value ?? '').split(' && ');
    if (want.empty) { if (given && got.use !== 'propose') found.push(`${field}: answered, wanted empty`); }
    else if (!got) { if (!want.maybeEmpty && (want.value || want.match || want.category)) found.push(`${field}: no answer`); continue; }
    else if (want.value && !(want.maybeEmpty && !given) && !parts.every(part => want.value.includes(part)) && !want.value.includes(got.value)) found.push(`${field}: "${got.value}", wanted ${want.value.join(' or ')}`);
    else if (want.match && !(want.maybeEmpty && !given) && !new RegExp(want.match, 'i').test(typed(got))) found.push(`${field}: "${typed(got)}", wanted /${want.match}/`);
    if (want.notMatch && new RegExp(want.notMatch, 'i').test(typed(got))) found.push(`${field}: "${typed(got)}", must not say /${want.notMatch}/`);
    if (want.within && given && !parts.every(part => want.within.includes(part))) found.push(`${field}: "${got.value}" is not one of the options`);
    if (want.category && got && got.category !== want.category) found.push(`${field}: category ${got.category}, wanted ${want.category}`);
    if (want.use && got && got.use !== want.use) found.push(`${field}: use ${got.use}, wanted ${want.use}`);
  }
  return found;
}

// An extraction reply against the facts a posting states: expect = {paths: {'a.b': [allowed values]}, has: {list: [entry parts a list item must carry]}} -> [problems].
export function factProblems(data, expect) {
  const found = [];
  for (const [path, allowed] of Object.entries(expect.paths || {})) {
    const got = path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), data);
    if (got === undefined) found.push(`${path}: missing`);
    else if (!allowed.includes(got)) found.push(`${path}: ${JSON.stringify(got)}, wanted ${allowed.join(' or ')}`);
  }
  for (const [list, wanted] of Object.entries(expect.has || {})) {
    const items = Array.isArray(data?.[list]) ? data[list] : [];
    for (const part of wanted) if (!items.some(item => Object.entries(part).every(([key, value]) => item?.[key] === value))) found.push(`${list}: no entry like ${JSON.stringify(part)}`);
  }
  return found;
}

// A kit reply (src/ai/kit.py) against what can be checked without a reference text: expect = {eligible}, ground = the profile + posting text the kit may draw on -> [problems].
export function kitProblems(data, expect, ground = '') {
  const found = [];
  if (data?.eligible !== expect.eligible) found.push(`eligible: ${data?.eligible}, wanted ${expect.eligible}`);
  if (!String(data?.cover_letter || '').trim()) found.push('cover_letter: empty');
  const highlights = Array.isArray(data?.highlights) ? data.highlights.length : 0;
  if (highlights < 3 || highlights > 5) found.push(`highlights: ${highlights}, wanted 3-5`);
  if (data?.eligible === true && String(data?.eligibility_note || '').trim()) found.push('eligibility_note: set although eligible');
  const known = new Set(String(ground).match(/\d+/g) || []);
  const letter = String(data?.cover_letter || '');
  for (const figure of new Set(letter.match(/\d+/g) || [])) {
    if (!known.has(figure)) found.push(`cover_letter: invented figure ${figure} ("${letter.slice(Math.max(0, letter.search(new RegExp(`\\b${figure}\\b`)) - 25), letter.search(new RegExp(`\\b${figure}\\b`)) + 15).replace(/\s+/g, ' ')}")`);
  }
  return found;
}

const ranks = values => {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), out = Array(values.length);
  for (let i = 0; i < order.length;) {   // ties share their average rank
    let j = i; while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
};

// Spearman rank correlation of two lists of numbers (null when fewer than 3 pairs or no spread).
export function spearman(a, b) {
  if (a.length !== b.length || a.length < 3) return null;
  const x = ranks(a), y = ranks(b), mean = values => values.reduce((s, v) => s + v, 0) / values.length, mx = mean(x), my = mean(y);
  const cov = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0), sx = Math.hypot(...x.map(v => v - mx)), sy = Math.hypot(...y.map(v => v - my));
  return sx && sy ? cov / (sx * sy) : null;
}

// How many of the baseline's top-k ids the model's top-k also holds (0..1).
export function topOverlap(baseline, model, k) {
  const top = scores => new Set(Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id));
  const want = top(baseline), got = top(model);
  return want.size ? [...want].filter(id => got.has(id)).length / want.size : null;
}

// One model's results over the cases -> the table row. results: [{id, valid, schemaOk, score, baseline, usage, ms}].
export function summarize(model, results, {k = 5} = {}) {
  const n = results.length || 1, share = pick => Math.round(100 * results.filter(pick).length / n);
  const paired = results.filter(r => Number.isFinite(r.score) && Number.isFinite(r.baseline));
  const modelScores = Object.fromEntries(paired.map(r => [r.id, r.score])), baseScores = Object.fromEntries(paired.map(r => [r.id, r.baseline]));
  const rho = spearman(paired.map(r => r.score), paired.map(r => r.baseline));
  const ms = results.map(r => r.ms).filter(Number.isFinite).sort((a, b) => a - b);
  return {model, cases: results.length, validJsonPct: share(r => r.valid), schemaPct: share(r => r.schemaOk),
    spearman: rho == null ? null : Math.round(rho * 100) / 100, topOverlap: paired.length >= k ? Math.round(100 * topOverlap(baseScores, modelScores, k)) : null,
    rightPct: results.some(r => 'right' in r) ? share(r => r.right) : null,
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
    tokensIn: results.reduce((s, r) => s + (r.usage?.input_tokens || 0), 0), tokensOut: results.reduce((s, r) => s + (r.usage?.output_tokens || 0), 0)};
}

export const table = (rows, usdPerCall = {}) => {
  const answers = rows.some(r => r.rightPct != null);
  return [`| Model | Cases | Valid JSON | In schema | ${answers ? 'Right answers' : 'Rank vs baseline (Spearman) | Same top 5'} | Median ms | Cost |`, `|---|---|---|---|${answers ? '---|' : '---|---|'}---|---|`,
    ...rows.map(r => `| ${r.model} | ${r.cases} | ${r.validJsonPct}% | ${r.schemaPct}% | ${answers ? `${r.rightPct}%` : `${r.spearman ?? 'n/a'} | ${r.topOverlap == null ? 'n/a' : `${r.topOverlap}%`}`} | ${r.medianMs ?? 'n/a'} | $${(usdPerCall[r.model] ?? 0).toFixed(4)} |`)].join('\n');
};
