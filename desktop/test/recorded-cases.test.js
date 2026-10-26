// "Never fix the same website twice" (tools/recorded-cases.mjs): a push changing how the app acts on pages brings its recorded page or scenario, or says why not (never with a seen failure behind it).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {LABEL_KEYS, casesOf, commitFiles, coveredFiles, displayOnlyProblems, isDisplayOnly, labelOnly, missingCase, untaggedActing, untaggedNewCases} from '../../tools/recorded-cases.mjs';
import {replayFiles} from '../../tools/replay-files.mjs';
import {FLOW_FILES} from '../e2e/flows.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url)), loaded = replayFiles(root), covered = coveredFiles(root, FLOW_FILES);
const commit = (files, message = '') => ({files, message});

test('a fill or flow change without a case is stopped; a case, a scenario or a stated reason lets it through', () => {
  assert.match(missingCase([commit(['extension/page/controls.js'], 'Fix a menu')], covered), /recorded page/);
  assert.match(missingCase([commit(['extension/fill-flow.js'])], covered), /fill-flow\.js/);
  assert.equal(missingCase([commit(['extension/page/controls.js', 'desktop/e2e/recorded/menu-1/case.json'])], covered), '');
  assert.equal(missingCase([commit(['extension/fill-flow.js', 'desktop/test/journeys.test.js'])], covered), '');
  // A field replay alone is not proof (10 Oct 2026: an Ashby fix passed with one and never reached the Fixed-site replays list); with a recorded page it is fine.
  assert.match(missingCase([commit(['extension/page/radios.js', 'worker/test/fixtures/fill/acme--salary.html'], 'Fix a group')], covered), /does not count/);
  assert.equal(missingCase([commit(['extension/page/radios.js', 'worker/test/fixtures/fill/acme--salary.html', 'desktop/e2e/recorded/acme-1/case.json'])], covered), '');
  assert.equal(missingCase([commit(['extension/fill-flow.js'], 'Log the press\n\nRecorded-unneeded: a log line only')], covered), '');
});

test('a Display-only marked file needs no recorded page; every file that fills or judges still does (owner, 22 Oct 2026)', () => {
  assert.ok(loaded.has('desktop/lib/run-rows.js') && !covered.has('desktop/lib/run-rows.js'));
  assert.equal(missingCase([commit(['desktop/lib/run-rows.js'], 'Show a run record')], covered), '');
  for (const file of ['desktop/lib/ladder/fill-verify.js', 'desktop/lib/form-judge.js', 'desktop/lib/ai/index.js', 'desktop/lib/ladder/value-class.js', 'desktop/lib/page-kind.js', 'desktop/lib/server.js']) {
    assert.ok(covered.has(file), `${file} must stay covered`);
    assert.match(missingCase([commit([file], 'Fix it')], covered), /recorded page/, file);
  }
  // Every marked file keeps its claim: it imports only marked files.
  assert.deepEqual(displayOnlyProblems(root, loaded), []);
});

test('a marked file that gains a judging or filling import fails; an unmarked one is covered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'display-only-'));
  fs.mkdirSync(path.join(dir, 'desktop/lib/ladder'), {recursive: true});
  const write = (file, text) => fs.writeFileSync(path.join(dir, file), text);
  write('desktop/lib/rows.js', "// Display-only: a record's view.\nimport {judge} from './ladder/judge.js';\n");
  write('desktop/lib/ladder/judge.js', '// Judges a field.\nexport const judge = 1;\n');
  write('desktop/lib/leaf.js', '// Display-only: a pattern.\nexport const x = 1;\n');
  assert.deepEqual(displayOnlyProblems(dir, ['desktop/lib/rows.js']), ['desktop/lib/rows.js is marked Display-only but imports desktop/lib/ladder/judge.js']);
  write('desktop/lib/rows.js', "// Display-only: a record's view.\nimport {x} from './leaf.js';\n");
  assert.deepEqual(displayOnlyProblems(dir, ['desktop/lib/rows.js']), []);
  assert.equal(isDisplayOnly(dir, 'desktop/lib/ladder/judge.js'), false);
});

test('hole 1: every extension file a replay loads is covered, found by structure (the class, not a list)', () => {
  // The files the old gate missed: the consent, popup and dialog scripts and a desktop/lib rung the replay's app runs.
  for (const file of ['extension/consent.js', 'extension/popup-guard.js', 'extension/dialog-after-fill.js', 'desktop/lib/ladder/rung2-sketch.js']) {
    assert.ok(covered.has(file), `${file} is loaded by a replay and must be covered`);
    assert.match(missingCase([commit([file], 'Fix it')], covered), /recorded page/, file);
  }
  // Every extension script the manifest's service worker or the page-file lists reach is covered; the flow's extension files all are.
  for (const file of FLOW_FILES.filter(one => one.startsWith('extension/'))) assert.ok(covered.has(file), `${file} (FLOW_FILES) is not found by the structure walk`);
  const pageFiles = fs.readdirSync(new URL('../../extension/page/', import.meta.url)).filter(name => name.endsWith('.js'));
  for (const name of pageFiles) assert.ok(covered.has(`extension/page/${name}`), `extension/page/${name} is not reached from the manifest: the replay would never load it, or the walk misses a file list`);
  // Every file of the flow is covered; the ones the replay's app does not load (the Electron main process registers them) cannot be proven by a replay, so a journey scenario is their proof.
  for (const file of FLOW_FILES) assert.ok(covered.has(file), file);
  const unloaded = FLOW_FILES.filter(file => !loaded.has(file)).sort();
  assert.ok(unloaded.includes('desktop/lib/session-flow.js') && unloaded.length < 15, `flow files outside the replay: ${unloaded.join(', ')}`);
  assert.match(missingCase([commit(['desktop/lib/session-flow.js'], 'Fix a tab')], covered), /recorded page/);
  assert.equal(missingCase([commit(['desktop/lib/session-flow.js', 'desktop/test/journeys.test.js'], 'Fix a tab')], covered), '');
  // The harness, tools and tests are not covered: they may say Recorded-unneeded (or nothing).
  for (const file of ['desktop/e2e/lib/live-row.mjs', 'tools/ship.sh', 'desktop/test/x.test.js', 'docs/x.md', 'extension/manifest.json']) assert.ok(!covered.has(file), file);
});

test('hole 2: "Recorded-unneeded" cannot excuse a fix to a seen failure', () => {
  const unneeded = 'Recorded-unneeded: log only';
  // f3e4596's shape: a filler change that fixes a pool row, with the excuse added.
  const refused = missingCase([commit(['extension/page/fill-menus.js'], `Menus that load page by page\n\n${unneeded}\nPool-row: Breitling SuccessFactors`)], covered);
  assert.match(refused, /Recorded-unneeded:" is refused/);
  assert.match(missingCase([commit(['extension/page/fill-menus.js'], `Fix\n\nFixes #412\n${unneeded}`)], covered), /refused/);
  assert.match(missingCase([commit(['desktop/lib/ladder/rung2-sketch.js'], `Fix\n\nRefs #9\n${unneeded}`)], covered), /refused/);
  // 5b9a14c's shape: harness only, a pool row, the excuse: allowed. A covered refactor with the excuse and no failure: allowed.
  assert.equal(missingCase([commit(['desktop/e2e/lib/live-row.mjs', 'desktop/e2e/live.mjs'], `A live row\n\n${unneeded}\nPool-row: FNAC Suisse jobs, French`)], covered), '');
  assert.equal(missingCase([commit(['extension/page/fill-menus.js'], `Rename a helper\n\n${unneeded}`)], covered), '');
  // "Pool-row: none <why>" (5ca78f7: every acting push names a row or none) names no failure: with the excuse it is allowed (12 Oct 2026, a prompt rule refused).
  assert.equal(missingCase([commit(['extension/page/fill-menus.js'], `Rename a helper\n\n${unneeded}\nPool-row: none a refactor, no row`)], covered), '');
  // The excuse is per commit: a harmless commit's excuse does not cover another commit's fix in the same push; a case in the push does.
  assert.match(missingCase([commit(['extension/log.js'], `Log\n\n${unneeded}`), commit(['extension/page/radios.js'], 'Fix a group\n\nPool-row: X')], covered), /recorded page/);
  assert.equal(missingCase([commit(['extension/page/fill-menus.js', 'desktop/e2e/recorded/menus-1/case.json'], `Fix\n\n${unneeded}\nPool-row: Breitling SuccessFactors`)], covered), '');
});

test('the push\'s own recorded cases are named, for the fails-on-old replay', () => {
  assert.deepEqual(casesOf(['desktop/e2e/recorded/a-1/case.json', 'desktop/e2e/recorded/a-1/pages/1.html', 'desktop/e2e/recorded/b-1/case.json', 'extension/log.js', 'desktop/test/journeys.test.js']), ['a-1', 'b-1']);
});

test('the check is wired into the push hook', () => {
  assert.match(fs.readFileSync(new URL('../../tools/pre-push-check.sh', import.meta.url), 'utf8'), /node tools\/recorded-cases\.mjs --base origin\/main/);
});

test('a push that adds a recorded case names the pool row it fixes, or says none and why (the Fixed tab lists fixes by row)', () => {
  // 12 Oct 2026: 6 of 8 round-1 fixes had no Pool-row line, so /admin/form-filling/lab's Fixed tab showed 2 of 8.
  assert.match(untaggedNewCases(['phone-widget-reverts-typed-1'], ['A box holding only a country code is empty']), /phone-widget-reverts-typed-1/);
  assert.equal(untaggedNewCases(['paged-menu-1'], ['Menus page by page\n\nPool-row: Breitling SuccessFactors']), '');
  assert.equal(untaggedNewCases(['zoo-toggle-1'], ['A zoo page\n\nPool-row: none a hand-made shape, no pool row']), '');
  assert.match(untaggedNewCases(['x-1'], ['Fix\n\nPool-row: none']), /x-1/, 'none needs its reason');
  assert.equal(untaggedNewCases([], ['anything']), '', 'no new case: nothing asked');
});

test('any push that changes how the app acts on pages names its pool row, or says none and why (a prompt fix like #424 skipped the Fixed tab)', () => {
  const acting = [...covered][0];
  assert.match(untaggedActing([commit([acting], 'Answers from saved facts')], covered), /Pool-row/);
  assert.equal(untaggedActing([commit([acting], 'Fix\n\nPool-row: FNAC Suisse jobs, French')], covered), '');
  assert.equal(untaggedActing([commit([acting], 'Refactor\n\nPool-row: none a pure move')], covered), '');
  assert.match(untaggedActing([commit([acting], 'x\n\nPool-row: none')], covered), /Pool-row/, 'none needs its reason');
  assert.equal(untaggedActing([commit(['docs/rules/rounds.md'], 'Docs')], covered), '', 'nothing the app acts with: nothing asked');
});

test('a case.json edit that changes only label keys brings no case: neither proof for a page fix nor a case "New test pages fail on the old build" replays', () => {
  // 12 Oct 2026, PR #501: adding `origin` to all 74 cases read as 74 new cases that had to fail on main's code (the old-build check red).
  const json = value => JSON.stringify(value, null, 2);
  const before = json({shape: 'A menu', why: 'x', expect: {filled: ['#a']}});
  assert.equal(labelOnly(before, json({shape: 'A menu', why: 'x', expect: {filled: ['#a']}, origin: 'captured'})), true);
  for (const key of LABEL_KEYS) assert.equal(labelOnly(before, json({...JSON.parse(before), [key]: 'reworded'})), true, key);
  assert.equal(labelOnly(before, json({shape: 'A menu', why: 'x', expect: {filled: ['#b']}, origin: 'captured'})), false, 'what it replays changed too');
  assert.equal(labelOnly('', before), false, 'a new case is a case');
  assert.equal(labelOnly(before, '{'), false, 'unreadable: counted');
  // On a real repository, through both gates' one source of files.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-label-keys-')), git = (...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8'});
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(repo, file)), {recursive: true}); fs.writeFileSync(path.join(repo, file), text); };
  try {
    git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T');
    write('desktop/e2e/recorded/a-1/case.json', before); write('desktop/e2e/recorded/b-1/case.json', before); write('extension/page/radios.js', '1');
    git('add', '-A'); git('commit', '-qm', 'base');
    write('desktop/e2e/recorded/a-1/case.json', json({...JSON.parse(before), origin: 'captured'}));
    write('extension/page/radios.js', '2');
    git('commit', '-qam', 'Fix a group, label a case\n\nPool-row: X');
    const files = commitFiles(git, git('rev-parse', 'HEAD').trim());
    assert.deepEqual(files, ['extension/page/radios.js'], 'the label-only case.json is left out');
    assert.deepEqual(casesOf(files), [], 'nothing to replay for a label');
    assert.match(missingCase([commit(files, 'Fix a group\n\nPool-row: X')], ['extension/page/radios.js']), /recorded page/, 'a label is no proof for a page fix');
    write('desktop/e2e/recorded/b-1/case.json', json({...JSON.parse(before), expect: {filled: ['#b']}, origin: 'captured'}));
    git('commit', '-qam', 'Tighten a case');
    assert.deepEqual(casesOf(commitFiles(git, git('rev-parse', 'HEAD').trim())), ['b-1'], 'a real change beside a label still counts');
  } finally { fs.rmSync(repo, {recursive: true, force: true}); }
});

test('the replay reads a label key only for its test\'s title and failure message, so a label edit cannot change a verdict', () => {
  const replayPath = ['e2e/test/recorded-pages.test.mjs', 'e2e/lib/page-replay.mjs', 'e2e/lib/row-case-run.mjs', 'e2e/lib/row-replay.mjs', 'e2e/lib/replay-browser.mjs'];
  const reads = new RegExp(`\\bitem\\.(${LABEL_KEYS.join('|')})\\b`);
  const found = replayPath.flatMap(file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n').filter(line => reads.test(line)).map(line => `${file}: ${line.trim()}`));
  const allowed = /^e2e\/test\/recorded-pages\.test\.mjs: (test\(`\$\{item\.name\}: \$\{item\.shape\}`|assert\.deepEqual\(result\.failures, \[\], `\$\{item\.name\} \(\$\{item\.why \|\| ''\}\)`\))/;
  assert.deepEqual(found.filter(line => !allowed.test(line)), [], 'a label key now decides a replay: take it out of LABEL_KEYS (tools/recorded-cases.mjs)');
  assert.equal(found.length, 2, 'the title and the failure message');
});

test('a ladder fixture is the proof of a decision fix (owner, 15 Oct 2026: row-to-case dropped)', () => {
  assert.equal(missingCase([commit(['extension/fill-flow.js', 'desktop/e2e/ladder-fixtures/fr-yes-no-step-1.json'], 'Digest: a disabled control is never named\n\nPool-row: Aldi Suisse jobs')], covered), '');
  assert.match(missingCase([commit(['extension/fill-flow.js'], 'Digest: a disabled control is never named\n\nPool-row: Aldi Suisse jobs')], covered), /ladder fixture/);
  assert.doesNotMatch(missingCase([commit(['extension/fill-flow.js'], 'x')], covered), /row-to-case --/);
});
