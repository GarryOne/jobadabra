// The decision-branch ratchet (tools/decision-branches.mjs; spec 2026-10-12-one-next-move.md phase 3, owner 12 Oct 2026: "a decision is data"): the page-kind/role conditions in
// consider() and the account step may only go down; a new one is a fixture or a learned move, or the owner's OK said in the baseline's reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {BASELINE_FILE, CONDITION, PLACES, bodyOf, counts, countIn, nextBaseline, verdict} from '../../tools/decision-branches.mjs';

test('the flow\'s decision code has no more page-kind/role conditions than the baseline, and no fewer left unlocked', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  assert.equal(verdict(counts(), baseline.counts), '');
});

test('each place is found (a rename never makes the count silently zero), and its conditions are counted', () => {
  const now = counts();
  for (const place of PLACES) assert.ok(now[place.name] > 0, `${place.file}: ${place.head} not found or no condition read`);
});

test('a condition is a role, kind, step, mode or answer compared with one of our words; a comment naming one is not counted', () => {
  const source = `function x() {}\nexport async function consider(tab) {\n  if (role === 'form') go();   // role === 'account' in a comment\n  if (kind?.role !== 'no-form' && step === 'sign_in') stop();\n  const y = {a: 1};\n  if (answer.mode === 'sign-up') z();\n}\nconst after = role === 'form';`;
  assert.equal(countIn(source, 'export async function consider('), 4);
  assert.match(bodyOf(source, 'export async function consider('), /answer\.mode/);
  assert.doesNotMatch(bodyOf(source, 'export async function consider('), /after/);
  assert.equal("x === 'form'".match(CONDITION), null, 'only the decision words');
});

test('more conditions fail with the rule; fewer must lock the gain; a raise needs the owner\'s reason', () => {
  assert.match(verdict({consider: 22, accountStep: 15}, {consider: 21, accountStep: 15}), /a decision is data: add a fixture or a learned move, or say why in "Decision-branch: <why>" \(owner's OK\)/);
  assert.match(verdict({consider: 20, accountStep: 15}, {consider: 21, accountStep: 15}), /lock the gain/);
  const before = {counts: {consider: 21, accountStep: 15}, reasons: [{date: '2026-10-12', reason: 'first'}]};
  assert.throws(() => nextBaseline({consider: 22, accountStep: 15}, before, 'one more branch'), /Decision-branch:/);
  assert.deepEqual(nextBaseline({consider: 22, accountStep: 15}, before, 'Decision-branch: a safety floor, owner OK 14 Oct', '2026-10-14').reasons.at(-1), {date: '2026-10-14', reason: 'Decision-branch: a safety floor, owner OK 14 Oct'});
  assert.deepEqual(nextBaseline({consider: 20, accountStep: 15}, before, 'a branch became data', '2026-10-14').counts, {consider: 20, accountStep: 15});
  assert.throws(() => nextBaseline({consider: 20, accountStep: 15}, before, ' '), /reason/);
});

// A helper's destructured parameters are not its body: endingLine retains consider's account-page condition.
test('conditions after destructured parameters and nested default arguments are counted', () => {
  const source = "function endingLine(role, {botCheck}, fallback = (() => ({}))()) { if (role === 'account') stop(); }";
  assert.equal(countIn(source, 'function endingLine('), 1);
  assert.match(bodyOf(source, 'function endingLine('), /role === 'account'/);
});

// Both step modules are scanned in full, so future helper names do not need registration.
test('the split page-read and action decisions are tracked as whole files', () => {
  const now = counts();
  for (const [name, expected] of [['fill-flow-read.js', 6], ['fill-flow-steps.js', 14]]) {
    const places = PLACES.filter(place => place.file === `extension/${name}`);
    assert.equal(places.length, 1, `${name} must have one whole-file entry`);
    assert.equal(places[0].head, undefined, `${name} must not be restricted to a function`);
    assert.equal(now[name], expected, name);
  }
});

// A split may redistribute the count, but the update still needs a reason and must not hide a total increase.
test('a per-function redistribution keeps the total; a real total increase still needs owner approval', () => {
  const before = {counts: {consider: 21, accountStep: 15}};
  const moved = {consider: 20, askPage: 1, accountStep: 15};
  assert.deepEqual(nextBaseline(moved, before, 'same conditions, moved').counts, moved);
  assert.throws(() => nextBaseline({...moved, askPage: 2}, before, 'same conditions, moved'), /Decision-branch:/);
  assert.throws(() => nextBaseline({consider: 19, askPage: 2, accountStep: 15}, {counts: moved}, 'same total'), /Decision-branch:/, 'an already tracked function still cannot grow without approval');
});

// A function that did not exist when PLACES was written must still be subject to the ratchet.
test('a condition in a new helper in a step file is counted', t => {
  const before = counts(), read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    const source = read(file, ...args);
    return String(file).replaceAll('\\', '/').endsWith('/extension/fill-flow-steps.js')
      ? `${source}\nfunction newlyAddedHelper(role) { if (role === 'account') return true; }\n`
      : source;
  });
  const after = counts();
  const sum = values => Object.values(values).reduce((total, count) => total + count, 0);
  assert.equal(sum(after), sum(before) + 1);
  assert.equal(after['fill-flow-steps.js'], before['fill-flow-steps.js'] + 1);
  assert.match(verdict(after, before), /a new page-kind\/role condition/);
});
