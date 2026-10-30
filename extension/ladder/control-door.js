// The control level of the one door (spec fill-ladder, 5: "same door"): a control the fill could not settle gets a record {level: 'control', rung, signal, reason, tried}, logged at the page level's
// door (dead-end.js) as "dead end: <signal>" with its own door id and `level: 'control'`, so a reader that counts page stops skips it by that field, never by its words (ending.mjs, desktop/e2e/lib/pool-shadow.mjs,
// desktop/e2e/lib/pool-gaps.mjs). Signals mirror core.js: stalled (the control used its tries), contradicted (the check says the page holds another answer), failed (the check could not reach it or the try
// did not work), refused (a repair was declined or left to the person), unsure. Evidence is fixed values only (dead-end.js evidenceOf): the control's fingerprint, never its label or value.
// Logging only: nothing here changes what the fill does. next-move adds `resolved: {by, verb, candidate, form}` to the same line. Guard: worker/test/control-door.test.js.
import {evidenceOf, nextDoor} from './dead-end.js';

export const CONTROL_SIGNALS = ['stalled', 'contradicted', 'refused', 'unsure', 'failed'];
// The check's verdicts (fill-verify.js) that name a control as a door, and the signal each is.
export const VERDICT_SIGNAL = {wrong: 'contradicted', unreachable: 'failed', empty: 'stalled'};

// record: {rung, signal, reason, tried, fp}; decide: the log. -> the door's id, or 0 when the signal is not one of the five (nothing logged).
export function controlDoor(record = {}, decide = () => {}, host = '') {
  if (!CONTROL_SIGNALS.includes(record.signal)) return 0;
  const door = nextDoor();
  const sent = decide('fill', `dead end: ${record.signal}`, {host, door, level: 'control', ...evidenceOf({rung: record.rung, signal: record.signal, reason: record.reason, tried: record.tried, fp: record.fp, level: 'control'})});
  sent?.catch?.(() => {});
  return door;
}

// The doors one repair pass opens (ladder/fill-climb.js): a control the fill check called wrong or unreachable (rung 4, verify), and a repair that was refused, left to the person or did not work
// (rung 3). sketch: the judges' sketch (controls with fp), verdicts: [{n, verdict}], results: [{n, ok}] (ok undefined: not tried). -> the door ids.
export function repairDoors({sketch, verdicts = [], results = []}, decide, host = '') {
  const fpOf = n => sketch?.controls?.[n - 1]?.fp || '';
  const doors = [];
  for (const row of verdicts) if (VERDICT_SIGNAL[row?.verdict] && Number.isInteger(Number(row.n))) doors.push(controlDoor({rung: 4, signal: VERDICT_SIGNAL[row.verdict], reason: 'verify', fp: fpOf(Number(row.n))}, decide, host));
  for (const row of results) if (row?.ok !== true && Number.isInteger(row?.n)) doors.push(controlDoor({rung: 3, signal: row.ok === undefined ? 'refused' : 'failed', reason: row.ok === undefined ? 'repair left' : 'repair failed', fp: fpOf(row.n)}, decide, host));
  return doors.filter(Boolean);
}
