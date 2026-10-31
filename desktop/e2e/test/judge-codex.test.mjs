// The verdict pass on the broker: the evidence a script fetches (cited code, where the quoted words are written), the verdict file in the old session's format, and the edit jobs' validated edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {evidenceFor, quotedWords, excerpt} from '../lib/judge-evidence.mjs';
import {renderVerdict, verdictFile, requestFor, NO_TOOLS} from '../judge-codex.mjs';
import {parse, checkEvidence} from '../lib/verdict-comment.mjs';
import {parseVerdicts} from '../lib/prejudge.mjs';
import {applyEdits, chosen, noneText, listing, filesBlock} from '../edit-codex.mjs';

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-'));
  fs.mkdirSync(path.join(root, 'desktop/renderer/pages'), {recursive: true});
  fs.writeFileSync(path.join(root, 'desktop/renderer/pages/activity.js'), Array.from({length: 80}, (_, i) => (i === 41 ? "bar.textContent = 'Could not read your CV: ' + error.message;" : `line ${i + 1}`)).join('\n'));
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'x']]) execFileSync('git', args, {cwd: root});
  return root;
}

test('the words a finding quotes are searched in the product code and the writing line is shown', () => {
  const root = repo();
  const text = 'The bar shows "Could not read your CV" with a raw error. See desktop/renderer/pages/activity.js:42 and `nothing written anywhere`.';
  assert.deepEqual(quotedWords(text), ['nothing written anywhere', 'Could not read your CV']);
  const evidence = evidenceFor({text, root});
  assert.match(evidence, /activity\.js:42 \(cited by the finding\)/);
  assert.match(evidence, /42: bar\.textContent = 'Could not read your CV/);
  assert.match(evidence, /search for "Could not read your CV" \(git grep\) ===\ndesktop\/renderer\/pages\/activity\.js:42:/);
  assert.match(evidence, /no file under the product code writes these words/);
  assert.equal(evidence.split('Could not read your CV: ').length - 1, 2, 'the cited lines and the search hit are shown once each, the hit line itself once more in the hit list');
  assert.ok(evidenceFor({text, root, budget: 200}).length < 260, 'cut at the budget');
  assert.equal(excerpt('missing.js', 3, {root}), '');
});

test('the verdict file is the old format: parse() reads the word, Why, Check, Cause, Severity; a real verdict without existing code is not trusted', () => {
  const v = {id: '1', verdict: 'real', why: 'desktop/renderer/pages/activity.js:42 prints it', check: '', cause: '', severity: 'high'};
  assert.deepEqual({...parse(renderVerdict(v))}, {word: 'real', why: 'desktop/renderer/pages/activity.js:42 prints it', check: '', cause: '', severity: 'high'});
  assert.equal(parse(renderVerdict({...v, verdict: 'false-positive', severity: 'high', cause: 'by-design'})).cause, 'by-design');
  assert.equal(parse(renderVerdict({...v, verdict: 'false-positive', severity: 'high'})).severity, '', 'a false positive carries no severity');
  assert.equal(parse(renderVerdict({...v, verdict: 'nonsense'})).word, 'needs-human');
  assert.equal(checkEvidence(renderVerdict(v), () => 0).word, 'needs-human');
  assert.equal(checkEvidence(renderVerdict(v), () => 80).word, 'real');
});

test('prejudge and exam: ## sections only for the ids asked, in prejudge.mjs parseVerdicts format; verdict mode needs a verdict', () => {
  const file = verdictFile('prejudge', [{id: 'a', verdict: 'harness', why: 'the test lost its page', check: '', cause: '', severity: ''}, {id: 'zzz', verdict: 'real', why: 'x', check: '', cause: '', severity: ''}], ['a', 'b']);
  assert.deepEqual(Object.keys(parseVerdicts(file, ['a', 'b'])), ['a']);
  assert.throws(() => verdictFile('verdict', []), /no verdict/);
});

test('one call carries the rules, the evidence and the screenshots, with no tools; the schema forces the verdict object', () => {
  const root = repo(), shot = path.join(root, 's.png');
  fs.writeFileSync(shot, 'png');
  const {body, ids} = requestFor({mode: 'prejudge', prompt: 'RULES', items: [{id: 'a', text: 'x "Could not read your CV"', logs: [], screenshot: shot}, {id: 'b', text: 'y', logs: [], screenshot: ''}], root});
  assert.deepEqual(ids, ['a', 'b']);
  assert.ok(body.system.startsWith(NO_TOOLS) && body.system.endsWith('RULES'));
  assert.equal(body.messages[0].content.filter(part => part.type === 'image').length, 1);
  assert.match(body.messages[0].content[0].text, /EVIDENCE for a[\s\S]*EVIDENCE for b/);
  assert.deepEqual(body.output_config.format.schema.required, ['verdicts']);
});

test('edits: all or none, only inside the allowed folders, the old text must occur once; a new file needs find ""', () => {
  const root = repo();
  const allow = /^(desktop\/renderer\/|desktop\/test\/[\w.-]+\.test\.js$)/;
  const bad = applyEdits({edits: [{path: 'desktop/renderer/pages/activity.js', find: 'line 3', replace: 'x'}, {path: 'tools/ship.sh', find: 'a', replace: 'b'}], allow, cwd: root});
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(), /outside the folders|occurs/);
  assert.match(fs.readFileSync(path.join(root, 'desktop/renderer/pages/activity.js'), 'utf8'), /^line 1$/m, 'nothing was written');
  assert.match(applyEdits({edits: [{path: 'desktop/renderer/pages/activity.js', find: 'line 1', replace: 'x'}], allow, cwd: root}).problems.join(), /occurs \d+ times/);   // "line 1" is in "line 10"…
  const good = applyEdits({edits: [{path: 'desktop/renderer/pages/activity.js', find: "'Could not read your CV: '", replace: "'Could not read your CV. '"}, {path: 'desktop/test/new.test.js', find: '', replace: 'ok\n'}], allow, cwd: root});
  assert.deepEqual(good, {ok: true, files: ['desktop/renderer/pages/activity.js', 'desktop/test/new.test.js']});
  assert.equal(applyEdits({edits: [{path: '../x', find: '', replace: 'a'}], allow: /./, cwd: root}).ok, false);
});

test('files to read: only listed ones, seeds first; the none-file is a verdict for the fixer and a summary for the Finder', () => {
  const root = repo(), {text, files} = listing(['desktop/renderer'], {cwd: root});
  assert.match(text, /^desktop\/renderer\/pages\/activity\.js \(80 lines\)$/);
  assert.deepEqual(chosen(['desktop/renderer/pages/activity.js', '/etc/passwd'], files, ['desktop/renderer/pages/activity.js']), ['desktop/renderer/pages/activity.js']);
  assert.match(filesBlock(['desktop/renderer/pages/activity.js'], {cwd: root}), /^=== desktop\/renderer\/pages\/activity\.js ===\nline 1/);
  assert.equal(noneText('verdict', {verdict: 'false-positive', why: 'by design'}), 'false-positive\nWhy: by design\n');
  assert.equal(noneText('verdict', {verdict: 'none', why: ''}, ['no edit']), 'needs-human\nWhy: no edit\n');
  assert.equal(noneText('summary', {verdict: 'none', why: 'nothing recurs'}), 'nothing recurs\n');
});

test('the flagged code\'s callers are in the evidence (3 of 4 live verdicts said "the evidence does not include the caller")', async () => {
  const {symbolsAt, callersOf} = await import('../lib/judge-evidence.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'callers-'));
  fs.mkdirSync(path.join(root, 'desktop/renderer'), {recursive: true});
  fs.writeFileSync(path.join(root, 'desktop/renderer/offer.js'), ['export function showOffer(box) {', '  const note = hostedOn(box);', "  box.textContent = error.message;", '}', ''].join('\n'));
  fs.writeFileSync(path.join(root, 'desktop/renderer/page.js'), ['import {showOffer} from "./offer.js";', 'function open() {', '  showOffer(document.body);   // any IPC failure reaches it', '}', ''].join('\n'));
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'x']]) execFileSync('git', args, {cwd: root});
  assert.deepEqual(symbolsAt('desktop/renderer/offer.js', 3, root), ['showOffer']);
  assert.deepEqual(symbolsAt('desktop/renderer/offer.js', 2, root), ['showOffer', 'hostedOn']);
  const parts = callersOf('showOffer', {file: 'desktop/renderer/offer.js', root});
  assert.match(parts[0].body, /page\.js:3:\s+showOffer\(document\.body\)/);
  assert.doesNotMatch(parts[0].body, /export function showOffer/, 'the declaration is not a caller');
  assert.match(parts[1].body, /any IPC failure reaches it/);
  const evidence = evidenceFor({text: 'The bar shows a raw error. See desktop/renderer/offer.js:3.', root});
  assert.match(evidence, /uses of showOffer\(\) \(git grep -w\)/);
  assert.match(evidence, /desktop\/renderer\/page\.js:3 \(calls showOffer\)/);
});

test('the second round: a needs-human that names what it needs gets it fetched and is asked once more (2 calls at most); an answer with nothing to ask, or a refusal, adds none', async () => {
  const {secondRound, VERDICTS_SCHEMA, FINAL_ROUND} = await import('../judge-codex.mjs');
  const {needEvidence} = await import('../lib/judge-evidence.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'second-'));
  fs.mkdirSync(path.join(root, 'desktop/renderer'), {recursive: true});
  fs.writeFileSync(path.join(root, 'desktop/renderer/offer.js'), ['export function bindOffer(turnOn) {', '  return turnOn();', '}', ''].join('\n'));
  fs.writeFileSync(path.join(root, 'desktop/renderer/page.js'), ['import {bindOffer} from "./offer.js";', 'bindOffer(() => window.api.sanitize(hostedOn()));   // the IPC error is turned into a plain sentence here', ''].join('\n'));
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'x']]) execFileSync('git', args, {cwd: root});
  assert.ok(VERDICTS_SCHEMA.properties.verdicts.items.required.includes('need'));
  const fetched = needEvidence(['bindOffer', 'desktop/renderer/page.js:2', 'noSuchName'], {root});
  assert.match(fetched, /declares bindOffer/);
  assert.match(fetched, /the IPC error is turned into a plain sentence here/);
  assert.match(fetched, /no file under the product code uses this name/);
  const item = {id: '2679', text: 'x', logs: [], evidence: 'FIRST EVIDENCE'};
  const asked = [];
  const ask = async (body) => { asked.push(body); return {ok: true, text: JSON.stringify({verdicts: [{id: '2679', verdict: 'false-positive', why: 'page.js:2 sanitizes it', check: '', cause: 'by-design', severity: '', need: []}]})}; };
  const first = [{id: '2679', verdict: 'needs-human', why: 'unclear', check: 'open the caller', cause: '', severity: 'high', need: ['bindOffer']}];
  const done = await secondRound({mode: 'verdict', prompt: 'P', items: [item], verdicts: first, root, ask});
  assert.equal(asked.length, 1);
  assert.equal(done.asked, 1);
  assert.equal(done.verdicts[0].verdict, 'false-positive');
  assert.match(asked[0].system, new RegExp(FINAL_ROUND.slice(0, 30)));
  assert.match(asked[0].messages[0].content[0].text, /FIRST EVIDENCE[\s\S]*ASKED FOR BY YOU[\s\S]*declares bindOffer/);
  for (const verdicts of [[{...first[0], need: []}], [{...first[0], verdict: 'real', need: ['bindOffer']}]]) {
    const none = await secondRound({mode: 'verdict', prompt: 'P', items: [item], verdicts, root, ask});
    assert.equal(none.asked, 0);
  }
  assert.equal(asked.length, 1, 'no further call');
  const refused = await secondRound({mode: 'verdict', prompt: 'P', items: [item], verdicts: first, root, ask: async () => ({ok: false, why: 'budget:week'})});
  assert.deepEqual([refused.verdicts, refused.skipped], [first, 'budget:week'], "a refused second round keeps the first round's verdicts");
});

test('prejudge: only the findings that asked are asked again, the others keep their first verdict', async () => {
  const {secondRound} = await import('../judge-codex.mjs');
  const items = [{id: 'a', evidence: 'EA'}, {id: 'b', evidence: 'EB'}];
  const first = [{id: 'a', verdict: 'needs-human', need: ['foo'], why: '', check: '', cause: '', severity: ''}, {id: 'b', verdict: 'real', need: [], why: 'ok', check: '', cause: '', severity: 'low'}];
  const done = await secondRound({mode: 'prejudge', prompt: 'P', items, verdicts: first, ask: async () => ({ok: true, text: JSON.stringify({verdicts: [{id: 'a', verdict: 'real', why: 'seen', check: '', cause: '', severity: 'low', need: []}]})})});
  assert.deepEqual(done.verdicts.map(v => [v.id, v.verdict]), [['a', 'real'], ['b', 'real']]);
  assert.equal(done.asked, 1);
});
