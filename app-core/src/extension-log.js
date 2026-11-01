// What the extension's own log lines (POST /extension/log) may carry across the boundary: counts, ids and reasons, never a form answer or a page's text (lib/log.js's rule).
// Scalars stay (strings cut to 60), the fill's field rows go through fieldRows, and a COUNT MAP (digit keys, number values: the attempt log's "tries per control") becomes a short
// string "1:3,2:1". Anything else that is not a scalar (or a key past the 8th) is cut AND named in `dropped` (13 Oct 2026: byTries and worked arrived as "" and the cap could not be measured, because the cut
// said nothing). Names only, the extension's own fixed keys: no value, no label. Guard: test/extension-log.test.js.

const COUNT_KEY = /^\d{1,3}$/;
const isCountMap = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 12
  && Object.entries(value).every(([key, count]) => COUNT_KEY.test(key) && Number.isFinite(count));
const asCounts = value => Object.entries(value).map(([key, count]) => `${key}:${Math.round(count)}`).join(',').slice(0, 60);

// An entry's fields -> the cleaned fields. Up to 8 keys, each key cut to 24.
export function cleanFields(raw) {
  if (raw?.source === 'extension') return crashFields(raw);
  const out = {}, dropped = [], entries = Object.entries(raw && typeof raw === 'object' ? raw : {});
  for (const [name] of entries.slice(8)) dropped.push(String(name).slice(0, 24));   // past the 8th key: named too
  for (const [name, value] of entries.slice(0, 8)) {
    const key = String(name).slice(0, 24);
    if (name === 'fields' && Array.isArray(value)) out[key] = fieldRows(value);
    else if (typeof value === 'string') out[key] = value.slice(0, 60);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (isCountMap(value)) out[key] = asCounts(value);
    else { out[key] = ''; dropped.push(key); }
  }
  return dropped.length ? {...out, dropped: dropped.join(',').slice(0, 60)} : out;
}

// Invariant: only fixed wording, native types, version numbers and filename/line frames cross the crash boundary.
function crashFields(raw) {
  const type = /^(?:Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError|AggregateError)$/.test(raw.type) ? raw.type : 'Error';
  const rejection = raw.rejection === true;
  const at = String(raw.at || '').split('\n').filter(line => /^at [\w-]+\.m?js:\d{1,9}:\d{1,9}$/.test(line)).slice(0, 8).join('\n');
  return {source: 'extension', type, error: rejection ? `Unhandled ${type} rejection` : `Uncaught ${type}`, at, rejection,
    version: /^\d+(?:\.\d+){1,3}$/.test(raw.version) ? raw.version : ''};
}

// A fill's per-field outcomes (extension/background.js "fields: …"): the one list the log boundary lets through, row by row and only these
// keys, each a short string (and the required flag): the form's wording and kinds, never an answer (8 Oct 2026: "what happened to this field?" needed page probes).
export function fieldRows(rows) {
  const keep = {label: 50, type: 16, outcome: 12, source: 30, reason: 80};
  return rows.slice(0, 40).filter(row => row && typeof row === 'object')
    .map(row => ({...Object.fromEntries(Object.entries(keep).map(([key, max]) => [key, typeof row[key] === 'string' ? row[key].slice(0, max) : ''])),
      // Whether the page marks it required (a boolean, never a value): without it the smoke report counted an optional field left empty as a failure
      // on every site (11 Oct 2026, Datadog "Website"; the extension kept it since c67f153, this boundary dropped it).
      ...(typeof row.required === 'boolean' ? {required: row.required} : {}),
      // The pack meaning that placed the field (a field key such as "location", never a value), only when there was one (the live twin loop, 9 Oct 2026).
      ...(typeof row.alias === 'string' && /^[a-z_]{1,30}$/.test(row.alias) ? {alias: row.alias} : {})}));
}

/** The /extension/log entries as the route keeps them: the last 50, each cut to short fields. One copy, used by the route and by the e2e stand-in for it. */
export const cleanEntries = entries => (Array.isArray(entries) ? entries : []).slice(-50).map(entry => ({
  at: typeof entry?.at === 'string' ? entry.at.slice(0, 30) : '', kind: String(entry?.kind || 'note').slice(0, 24),
  text: String(entry?.text || '').slice(0, 300), fields: cleanFields(entry?.fields)}));
