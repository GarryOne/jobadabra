// The proof behind `npm run row-to-case -- "<row>" <case>` (skill fix-recorded-sites): a pool row's capture becomes a case in the recorded cases folder ONLY when it proves itself.
//   1. the capture is built into a staging folder (lib/row-case.mjs: scrubbed, shrunk, privacy and size gates);
//   2. --ask-cold: the NEW build's model calls the case does not keep yet are asked ONCE on the plan path and kept in the case's memo (a prompt change makes new asks; CI has no claude -p);
//   3. the NEW build replays it with no cold ask; its signature (page kinds, presses, per-field outcome and reason) against the LIVE run's gives `expect` (lib/row-signature.mjs): the tool's, never the fixer's;
//   4. the OLD build (--old <extension folder>) must replay the live run's page kinds and presses (else the case is not the live run) and must FAIL the case (else exit 3, as recorded-both).
// --fixed: the capture came from a build that already has the fix (a regression case, no failing live run): expect = the live run itself and the old build must fail it (exit 3 when it does not).
// Exit codes: 0 written; 1 the new build fails its own case; 2 refused before replaying (gates, an existing case, no old build); 3 the old build passes (the control proves nothing); 4 not provable
// (a cold ask is left, nothing improved, a regression, the old build does not replay the live run). -> {code, lines}; nothing reaches the cases folder unless code is 0. Guard: e2e/test/pool/row-to-case.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appProfileTexts, personalValues, scrub} from './capture-page.mjs';
import {buildCase} from './row-case.mjs';
import {runRowCase} from './row-case-run.mjs';
import {replayRow} from './row-replay.mjs';
import {baselineSignature, expectFrom, filledBoxes, signatureOf} from './row-signature.mjs';

// A capture's field label -> the replay's label for the same field: equal once reduced to letters and digits (no ✱, spaces or punctuation), or one is the start of the other (at least 12 characters).
const squash = label => String(label).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export const labelMatcher = labels => {
  const known = labels.map(label => [label, squash(label)]);
  return wanted => {
    const key = squash(wanted);
    return (known.find(([, other]) => other === key) || known.find(([, other]) => key.length >= 12 && other.length >= 12 && (other.startsWith(key) || key.startsWith(other))) || [])[0];
  };
};

// A row from reports-fetch.mjs is named reported-<id>-<site>: the case says which ⚑ report it was cut from (tools/owner-report.mjs).
const reportOf = rowDir => { const id = /^reported-([0-9a-f]{6,})-/.exec(path.basename(String(rowDir)))?.[1]; return id ? {report: id} : {}; };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export async function rowToCase({rowDir, name, outDir, oldDir, askCold = false, fixed = false, stub = [], build = buildCase, replay = replayRow, values = personalValues(appProfileTexts()), say = () => {}}) {
  const step = text => say(`row-to-case: ${text}`);   // one line per stage as it starts (a replay takes up to 90 s and prints nothing else)
  const lines = [], end = (code, line) => { lines.push(line); return {code, lines}; };
  if (!oldDir) return end(2, 'row-to-case: name the OLD build (the fix\'s parent): --old <extension folder> (a case that cannot fail on the old build proves nothing)');
  if (fs.existsSync(path.join(outDir, name))) return end(2, `row-to-case: ${path.join(outDir, name)} exists; pick a new case name (an old case is never overwritten)`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-to-case-'));
  try {
    let built;
    step('building the case (scrub, shrink, privacy and size gates)');
    try { built = await build({rowDir, name, outDir: staging, values, stub}); } catch (error) { return end(2, `row-to-case: ${error.message}`); }
    if (built.budget) lines.push(`row-to-case: ${built.budget}`);
    const caseFile = path.join(built.dir, 'case.json'), memoFile = path.join(built.dir, 'model-memo.json'), item = readJson(caseFile), asCase = expect => ({...item, name, dir: built.dir, expect});
    // The new build's cold asks, on the plan path (the offline app is the fake applicant; no API key), kept scrubbed beside their part hashes. Round 1 asks what the capture lacks; if the strict replay then still misses an ask
    // (the cold replay waits for the real model, so the extension's concurrent flows interleave differently from the strict replay's and make other asks), those are asked in the next round: up to 3, until a strict replay misses nothing.
    const coldAsk = async round => {
      step(`asking the new build's model calls on the plan path (round ${round}, replay up to 90 s)`);
      const cold = await replay(built.dir, {ask: true});
      fs.writeFileSync(memoFile, scrub(JSON.stringify({...readJson(memoFile), ...(cold.memoAfter || {})}), values));
    };
    let fresh, rounds = 0;
    for (;;) {
      if (askCold && (rounds === 0 || fresh.misses)) await coldAsk(++rounds);
      step('replaying on the NEW build (up to 90 s)');
      fresh = await replay(built.dir, {});
      if (!fresh.misses || !askCold || rounds >= 3) break;
    }
    if (askCold) lines.push(`row-to-case: the new build's model calls were asked ${rounds === 1 ? 'once' : `in ${rounds} rounds`} and kept in the case's memo`);
    const volatileKept = Object.entries(readJson(memoFile)).filter(([name]) => name.endsWith('#volatile')).flatMap(([, parts]) => parts);
    if (volatileKept.length) lines.push(`row-to-case: WARNING: a kept ask carries a clock time or a date in ${[...new Set(volatileKept)].join(', ')}: no memo can match it again; fix it at the source (a prompt carries no time)`);
    if (fresh.misses) return end(4, `row-to-case: ${fresh.misses} model ask(s) of the new build are not in the case's kept answers (CI has no claude -p): run again with --ask-cold${fresh.missParts?.length ? ` (the nearest kept ask differs in ${fresh.missParts.join(', ')})` : ''}`);
    // The OLD build is replayed now, before the verdict on the new one: the regression check and the control both need it (one replay, reused below).
    step('replaying on the OLD build (up to 90 s)');
    const oldRaw = await replay(built.dir, {extensionDir: oldDir, loose: true});
    const base = baselineSignature(item.baseline), derived = expectFrom(base, signatureOf(fresh), signatureOf(oldRaw));
    // --fixed: the capture was taken on a build that already has the fix (a regression case): the live run IS the expected behavior (plus whatever else the new build shows beyond it), the boxes the new
    // build ends with filled are expected too, and the old build must fail it. (An earlier version added the boxes only when the replay matched the live run exactly: with any difference the old build
    // had nothing to fail and "passed", 12 Oct 2026.)
    // ("regressed" is no refusal here: the live run was the fixed build, so there is no fix to regress; the new build's cold ask answered a question another way than the live AI did: that field is not asserted.)
    if (fixed && (!derived.refused || /^(nothing improved|the new build regressed)/.test(derived.refused))) {
      const more = derived.expect || {}, boxes = filledBoxes(fresh.boxes), seen = signatureOf(fresh).fields, byLabel = labelMatcher(Object.keys(seen));
      // The capture's labels are not the replay's: "Email" for "Email✱", a label cut at 40 characters, a country scrubbed out of a sentence. A live field is asserted under the replay's own label when they
      // match (the new build failed its own case on every unmatched one: "field X: absent", 61's Lever capture, 12 Oct 2026); one that matches nothing is named and left out.
      const kept = {}, unmatched = [], outcomeOf = value => String(value).split(':')[0];   // the live run's reason text is not the replay's (the offline app words it its own way): the outcome is compared, the replay's own value is kept
      for (const [label, value] of Object.entries(base.fields)) { const same = byLabel(label); if (same && outcomeOf(seen[same]) === outcomeOf(value)) kept[same] = seen[same]; else unmatched.push(label); }
      derived.refused = '';
      const outcomes = fields => Object.fromEntries(Object.entries(fields).map(([label, value]) => [label, outcomeOf(value)]));   // outcome only: the reason text is whichever kept answer the replay served
      derived.expect = {kinds: more.kinds || base.kinds, pressed: more.pressed || base.pressed, fields: outcomes({...kept, ...(more.fields || {})}), ...(Object.keys(boxes).length ? {boxes} : {})};
      if (unmatched.length) lines.push(`row-to-case: ${unmatched.length} live field(s) have no replay field of the same label and outcome (filled/left): not asserted: ${unmatched.map(label => label.slice(0, 40)).join('; ')}`);
      lines.push('row-to-case: --fixed: the live run was taken on the fixed build; its own behavior and the boxes it ends with are the expect');
    }
    if (derived.refused) return end(4, `row-to-case: ${derived.refused}`);
    const withExpect = asCase(derived.expect);
    // The OLD build: it must fail the case (else the control proves nothing) and replay the live run (else this case is not that run).
    const old = await runRowCase(withExpect, {extensionDir: oldDir, replay: async () => oldRaw});
    if (old.ok) return end(3, 'row-to-case: the OLD build passes this case: the control proves nothing; nothing written');
    if (old.signature.kinds.join() !== base.kinds.join() || old.signature.pressed.join() !== base.pressed.join()) {
      return end(4, `row-to-case: the old build (${oldDir}) does not replay the live run: page kinds ${old.signature.kinds.join(', ') || 'none'} (live ${base.kinds.join(', ') || 'none'}), presses ${old.signature.pressed.join(', ') || 'none'} (live ${base.pressed.join(', ') || 'none'})`);
    }
    lines.push(`row-to-case: the old build fails it as it must: ${old.failures.join('; ').slice(0, 300)}`);
    step('replaying on the NEW build against the written expect (up to 90 s)');
    const own = await runRowCase(withExpect, {replay});
    if (!own.ok) return end(1, `row-to-case: the new build fails its own case: ${own.failures.join('; ')}`);
    // The second speed (a slower machine: CPU x4 in the page, answers x1.6 + 0.3 s, the site's reactions x1.6): a case whose result depends on the clock fails CI on a slow runner and not here (12 Oct 2026: the Lever
    // case and the synthetic boxes case, both green on the Mac and red on Linux CI). Written only when it replays green at both.
    step('replaying on the NEW build again, slowed (CPU x4, answers x1.6 + 0.3 s)');
    const slowed = await runRowCase(withExpect, {replay, slow: true});
    if (!slowed.ok) return end(4, `row-to-case: timing-dependent: the new build passes its case at normal speed and not slowed: ${slowed.failures.join('; ').slice(0, 400)}; nothing written (the case would flake in CI)`);
    fs.writeFileSync(caseFile, `${JSON.stringify({origin: item.origin || 'captured', ...item, ...reportOf(rowDir), expect: derived.expect}, null, 1)}\n`);   // a row case is a live capture (lib/recorded-origin.mjs)
    fs.cpSync(built.dir, path.join(outDir, name), {recursive: true});
    lines.push(`row-to-case: ${name} written (${Math.round(built.bytes / 1024)} KB, ${built.verdict}); expect: ${JSON.stringify(derived.expect)}`);
    return {code: 0, lines};
  } finally { fs.rmSync(staging, {recursive: true, force: true}); }
}
