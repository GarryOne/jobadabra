// One owner of an Apply's dim and centred panel (owner, 27 Oct 2026): the worker's state (extension/apply-state.js) changes only on a verdict, and no other file lifts the dim by a timer or a page event.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {applyState, sayApply, setApply} from '../../extension/apply-state.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
const files = fs.readdirSync(root).filter(name => name.endsWith('.js'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const using = re => files.filter(name => re.test(read(name))).sort();

test('only the state owner and its verdict senders write an Apply state', () => {
  const writers = using(/\b(setApply|sayApply)\(/).filter(name => name !== 'apply-state.js');
  assert.deepEqual(writers, ['background.js', 'early-dim.js', 'fill-flow.js', 'messages-learning.js', 'stop.js', 'tabs.js'], 'a new writer of the state is a new way to flicker the dim: add it here only with the owner\'s say');
});

test('no timer, page event or removed layer lifts the dim or ends the working look', () => {
  const overlay = read('panel-overlay.js'), review = read('review.js');
  assert.doesNotMatch(overlay, /setTimeout\(\(\) => lift|Date\.now\(\) >|EARLY_MS|MAX_MS|isConnected\) \{ lift/, 'panel-overlay.js lifts only on the worker\'s verdict (or an extension reload)');
  assert.doesNotMatch(review, /setTimeout\(endStep|endSoon|END_GAP_MS|STEP_SAFETY_MS|STEP_FIRST_MS|fillOver/, 'review.js ends its working look only through the worker\'s verdict');
  const offs = using(/__jobPilottoOverlay\??\.off\(|overlay\.off\(/);
  assert.deepEqual(offs, ['review.js', 'settle-tabs.js'], 'who may take the layer down: the panel\'s look() on a verdict or its own close, and the sweep of a page the app did not open');
  assert.match(read('stop.js'), /setApply\(tabId, 'stopped'\)/, 'Stop is a verdict');
  assert.match(read('background.js'), /sayApply\(tabId, text, verdict\)/, 'the end of a run is a verdict, named by its caller');
});

test('a run that goes on elsewhere keeps its Apply: a watch re-look and a tab followed from the posting set working again', () => {
  assert.match(read('fill-flow.js'), /setApply\(tab\.id, 'working'\);[^\n]*\n\s*await consider\(live, jobUrl\)/, 'the watch for new fields starts the run again before it looks (steps are drawn only while working)');
  assert.match(read('tabs.js'), /applyState\(opener\) === WORKING\) setApply\(tab\.id, WORKING\)/, 'the tab Apply opens from the posting is the same application: its state goes with it');
});

// Design (#2800, 1 Nov 2026): a tab's Apply is working from its start to ONE end verdict. A piece of the run that ends (a fill pass, a cleared step) is not a verdict: it clears its step and the tab stays working.
// The fill's end is said once, on its page, by fillPage (fill-flow.js writeState). Run 41274202726: the pass's own `done` came ~310 ms before that write, the page drew "Fill again" with the fill still going.
test('a piece of the run that ends clears its step but leaves the tab working; only a named verdict ends it (#2800)', () => {
  const tab = 2800;
  setApply(tab, 'working');
  assert.equal(sayApply(tab, 'Filling the form…'), true, 'a step is drawn while working');
  assert.equal(sayApply(tab, ''), true, 'the cleared step is sent to the page');
  assert.equal(applyState(tab), 'working', 'a fill pass ending with no verdict named does not end the run (the page would draw "Fill again" mid-run)');
  sayApply(tab, '', 'done');
  assert.equal(applyState(tab), 'done', 'the run\'s own verdict ends it');
  assert.equal(sayApply(tab, 'Reading this page…'), true, 'a step after a done is the run on again (a no-form read, then a fill)');
  assert.equal(applyState(tab), 'working');
  setApply(tab, 'stopped');
  assert.equal(sayApply(tab, 'Filling the form…'), false, 'after Stop only the person\'s own start brings the run back; a step is not drawn');
  assert.equal(applyState(tab), 'stopped');
  setApply(tab, 'your-turn');
  assert.equal(sayApply(tab, 'Filling the form…'), false, 'after your-turn, same');
});
