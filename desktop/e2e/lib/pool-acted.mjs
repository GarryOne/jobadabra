// Job: report health
// The acted presses of CI pool runs (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 3 step 2 "press": pooled across the doors, >= 10 presses acted, 0 worse by effect, the unblock rate and the cost
// shown; per-door counts are the kill switch). Each "dead end fallback (acted)" line (extension/ladder/fallback.js) is judged by its EFFECT: worked / failed, and WORSE when the press led to an account page (the next
// page kind the run judged starts with "account": a sign-in or a password step) or the row's final reading is not the application any more (`left`). Pure: callers provide the logs; lib/measure.mjs reads captures.
// Guard: e2e/test/pool/pool-acted.test.mjs.
const ACTED = /^(\S+Z) \[extension\] fill: dead end fallback \(acted\) (\{.*\})\s*$/;
const KIND = /^(\S+Z) \[extension\] fill: page kind: ([a-z_-]+) /;
const parsed = text => { try { return JSON.parse(text); } catch { return {}; } };

// appLog -> [{door, why, effect, pressKind, ms, next}]: `next` is the first page kind judged after the press ('' when none)
export function actedOf(appLog = '') {
  const found = [];
  for (const text of String(appLog).split('\n')) {
    const press = ACTED.exec(text), kind = KIND.exec(text);
    if (press) { const fields = parsed(press[2]); found.push({door: fields.door, why: fields.why || '', effect: fields.effect || '', pressKind: fields.pressKind || '', ms: fields.ms || 0, next: ''}); }
    else if (kind) { const open = [...found].reverse().find(item => !item.next); if (open && !open.seen) { open.next = kind[2]; open.seen = true; } }
  }
  return found.map(({seen, ...item}) => item);
}

// rows: [{row, log, reached}] -> {acted, worked, failed, worse: [{row, door, why}], unblockRate, byDoor}
export function actedTable(rows = []) {
  const byDoor = {}, worse = [];
  let acted = 0, worked = 0, failed = 0, clean = 0;
  for (const {row, log, reached} of rows) for (const press of actedOf(log)) {
    const entry = byDoor[press.why] ||= {acted: 0, worked: 0, failed: 0, worse: 0};
    const bad = press.next.startsWith('account') || reached === 'left';
    acted++; entry.acted++;
    if (press.effect === 'worked') { worked++; entry.worked++; } else { failed++; entry.failed++; }
    if (bad) { entry.worse++; worse.push({row, door: press.door, why: press.why}); } else if (press.effect === 'worked') clean++;
  }
  return {acted, worked, failed, worse, unblockRate: acted ? clean / acted : 0, byDoor};
}

// A downloaded run folder (smoke-reports) -> Map(slug of the row name -> {reached, usd}) from its day report(s); the log files carry the same slug in their name.
import fs from 'node:fs';
import path from 'node:path';
export const slugOf = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function resultsOf(dir) {
  const found = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)); } catch { return found; }
  for (const file of files) { try { for (const [name, result] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).results || {})) found.set(slugOf(name), {reached: String(result?.reached || ''), usd: Number(result?.usd) || 0}); } catch { /* a cut report */ } }
  return found;
}
