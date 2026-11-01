// The fill's per-field record, settled at the end: one row per field, its outcome what the page holds once every pass is done.
// Each pass (the kit, the drop-down clicks, Claude on the page) wrote its own row at its own moment; a later pass, or a menu picked meanwhile,
// left rows saying "left" for fields that were filled (8 Oct 2026, the live twin: Coop's "Formule d'appel"). Used by flow.js; guarded by
// app-core/test/trace-settle.test.js. finalFields: the form as described at the end ([{label, field, filled}]); missing → the rows decide.
// gaveUp: boxes the page kept emptying after we typed them again, up to the limit ([{field, times}], page/browser-form-fastpath.js): the reason says so.
// readBack: rung 0's read of every control once the page settled (page/read-back.js pass: [{field, type, state, file?}]), the one truth the panel reads too
// (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 4): it names why a box is left, and the CV row is what its slot shows (cvName: the CV's file name), not what the operator hoped.
const LEFT_WHY = {mismatch: 'the page changed what was typed, by the end of the fill', unreachable: 'something lies over it at the end of the fill'};
const GAVE_UP = 'the site did not keep it after its tries: left for you';   // its one attempt log is spent (page/attempts.js), told once
const FILE_WHY = {unknown: 'the file was attached, but the slot shows no file: check it', empty: 'the page did not keep the file'};

// Counts per state, for the log line (no label, no value).
export const readBackCounts = rows => (rows || []).reduce((counts, row) => ({...counts, [row.state]: (counts[row.state] || 0) + 1}), {});

// The state of the slots this extension attached the CV to (by its file name; any of ours when the name is not known): committed if one shows it, else unknown if one is
// unreadable, else empty; '' when none (the operator's row stands).
const fileEnd = (readBack, cvName) => {
  const ours = (readBack || []).filter(row => row && row.type === 'file' && row.file && (!cvName || row.file === cvName));
  return !ours.length ? '' : ours.some(row => row.state === 'committed') ? 'committed' : ours.some(row => row.state === 'unknown') ? 'unknown' : 'empty';
};

export function settleTrace(trace = [], finalFields = [], gaveUp = [], readBack = [], cvName = '') {
  const gaveUpTimes = new Map((gaveUp || []).map(item => [item.field, item.times]));
  const fieldOf = new Map((finalFields || []).filter(field => field && field.label).map(field => [field.label, field.field]));
  const filledAtEnd = new Map((finalFields || []).filter(field => field && field.label).map(field => [field.label, !!field.filled]));
  const stateOf = new Map((readBack || []).filter(row => row && row.field).map(row => [row.field, row.state]));
  const spent = new Set((readBack || []).filter(row => row && row.field && row.gaveUp).map(row => row.field));
  const file = fileEnd(readBack, cvName);
  const rows = new Map();
  for (const row of trace || []) {
    if (!row || !row.label) continue;
    const before = rows.get(row.label);
    rows.set(row.label, before && before.outcome === 'filled' && row.outcome !== 'filled' ? {...row, ...before} : {...before, ...row});   // a fill is not undone by a later "left"
  }
  return [...rows.values()].map(row => {
    if (row.type === 'file' && row.source === 'your CV' && file) return file === 'committed' ? (row.outcome === 'filled' ? row : {...row, outcome: 'filled', reason: 'the slot shows the file by the end of the fill'}) : {...row, outcome: 'left', reason: FILE_WHY[file]};
    const end = filledAtEnd.get(row.label), state = stateOf.get(fieldOf.get(row.label));
    // Rung 0's LAST read (flow.js: after the fill ladder's repair or a late retype, ladder/fill-climb.js) outranks the earlier end read for a field the fill gave an answer: it holds it now.
    if (state === 'committed' && row.source && row.outcome !== 'filled') return {...row, outcome: 'filled', reason: 'filled by the end of the fill'};
    if (state === 'committed' && row.source) return row;
    if (end === true && row.outcome !== 'filled') return {...row, outcome: 'filled', reason: 'filled by the end of the fill'};
    if (end === false && row.outcome === 'filled' && row.type !== 'file' && row.type !== 'password') return {...row, outcome: 'left', reason: gaveUpTimes.has(fieldOf.get(row.label)) ? `empty again at the end of the fill: the page emptied it after we typed it ${gaveUpTimes.get(fieldOf.get(row.label))} times, so we stopped` : spent.has(fieldOf.get(row.label)) ? GAVE_UP : LEFT_WHY[state] || 'empty again at the end of the fill'};
    if (row.outcome !== 'filled' && spent.has(fieldOf.get(row.label)) && end !== true) return {...row, outcome: 'left', reason: GAVE_UP};
    return row;
  });
}
