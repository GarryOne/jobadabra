// What a row replay (or the live run) DID, as a small comparable signature, and the three things the row-to-case proof needs from it (owner, 11-12 Oct 2026: a case's `expect` comes from the live
// run's own result and the new build's replay, never from the fixer's hand): signatureOf(replay result) / baselineSignature(the capture's case.json), expectFrom(baseline, new) = the improvement
// (a later page kind, more presses, a field whose outcome or reason changed: "no answer" -> "proposed for you to confirm"), checkSignature(replay, expect) = the failures. Guard: test/row-signature.test.mjs.
import {replayPresses} from './row-follow.mjs';

const PAGE_KIND = /\[extension\] page kind: ([a-z-]+)/, KIND_LINE = /^page kind: ([a-z-]+)/;
const TIMING = / \(\d+(?:\.\d+)? ?s\)/g;   // "(1.2 s)": a duration, not a reason
const fieldValue = row => `${row.outcome}: ${String(row.reason || '').replace(TIMING, '').trim()}`;
const once = list => list.filter((item, at) => item !== list[at - 1]);

export function signatureOf(result) {
  const kinds = once(String(result.appLog || '').split('\n').map(line => line.match(PAGE_KIND)?.[1]).filter(Boolean));
  let trace = [];
  for (const request of (result.requests || []).filter(one => one.route === '/extension/run')) { try { trace = JSON.parse(request.body).trace || trace; } catch { /* a body cut at the limit */ } }
  return {kinds, pressed: replayPresses(result.requests || []).map(press => press.what), fields: Object.fromEntries(trace.map(row => [row.label, fieldValue(row)])), boxes: result.boxes || {}, diverged: !!result.divergence};
}

// The boxes that hold a value, as the expectation of a case taken on the fixed build (--fixed): a fix that retypes a box the page's autofill emptied shows only here, in the page the replay ends on. -> {label: 'filled'}
export const filledBoxes = boxes => Object.fromEntries(Object.entries(boxes || {}).filter(([, state]) => state === 'filled'));

// A case's stored `baseline` (lib/row-case.mjs: the live run's page-kind lines, its fields {label, outcome, reason} and the `what` of its presses) as a signature: what the LIVE run did.
export function baselineSignature({pageKinds = [], fields = [], pressed = []}) {
  return {kinds: once(pageKinds.map(line => String(line).match(KIND_LINE)?.[1]).filter(Boolean)), pressed, fields: Object.fromEntries(fields.map(row => [row.label, fieldValue(row)])), diverged: false};
}

// old: the OLD build's replay of the same case, when there is one: a field filled live and not now is a regression only where the old build's replay fills it too (the live AI's answer is not the replay's:
// a cold ask answers "Current company" another way, 12 Oct 2026). The improvements are worked out whatever the verdict (--fixed uses them).
export function expectFrom(base, now, old = null) {
  const expect = {};
  if (now.kinds.join() !== base.kinds.join() && now.kinds.length >= base.kinds.length) expect.kinds = now.kinds;
  if (now.pressed.join() !== base.pressed.join() && now.pressed.length >= base.pressed.length) expect.pressed = now.pressed;
  const lost = Object.keys(base.fields).filter(label => base.fields[label].startsWith('filled') && label in now.fields && !now.fields[label].startsWith('filled') && (!old || String(old.fields[label] || '').startsWith('filled')));
  const dropped = Object.keys(base.fields).filter(label => base.fields[label].startsWith('filled') && label in now.fields && !now.fields[label].startsWith('filled'));   // lost live or by the replay's AI: never an improvement to assert
  const fields = Object.fromEntries(Object.entries(now.fields).filter(([label, value]) => base.fields[label] !== value && !dropped.includes(label)));
  if (Object.keys(fields).length) expect.fields = fields;
  if (now.diverged) return {refused: 'the new build\'s replay diverged from the live run\'s presses; the case would not be a replay of the live run', expect};
  if (lost.length) return {refused: `the new build regressed: ${lost.join(', ')} was filled live and is not now`, expect};
  return Object.keys(expect).length ? {ok: true, expect} : {refused: 'nothing improved: the new build\'s replay shows the same page kinds, presses and field outcomes as the live run', expect};
}

export function checkSignature(sig, expect = {}) {
  const failures = [];
  if (expect.kinds && sig.kinds.join() !== expect.kinds.join()) failures.push(`page kinds: ${sig.kinds.join(', ') || 'none'}, expected ${expect.kinds.join(', ')}`);
  if (expect.pressed && sig.pressed.join() !== expect.pressed.join()) failures.push(`presses: ${sig.pressed.join(', ') || 'none'}, expected ${expect.pressed.join(', ')}`);
  // A value with no colon is an OUTCOME only ("filled", "left"): the reason text depends on which kept answer a replay served and follows the interleaving of the extension's flows (--fixed cases); one with "outcome: reason" is exact.
  for (const [label, value] of Object.entries(expect.fields || {})) if (!(value.includes(':') ? sig.fields[label] === value : sig.fields[label]?.split(':')[0] === value)) failures.push(`field ${label}: ${sig.fields[label] ?? 'absent'}, expected ${value}`);
  for (const [label, value] of Object.entries(expect.boxes || {})) if (sig.boxes?.[label] !== value) failures.push(`box ${label}: ${sig.boxes?.[label] ?? 'absent'}, expected ${value}`);
  if (sig.diverged) failures.push('diverged from the live run\'s presses');
  return failures;
}
