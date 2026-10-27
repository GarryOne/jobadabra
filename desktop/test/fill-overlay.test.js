// The fill overlay's contracts, read from the source (the browser test is desktop/e2e/test/fill-overlay.test.mjs): every debugger input goes through the driver gap, every end removes the overlay,
// and the overlay is hidden from the AI's picture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sources = dir => fs.readdirSync(new URL(`../../${dir}`, import.meta.url), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? sources(`${dir}${entry.name}/`) : entry.name.endsWith('.js') ? [`${dir}${entry.name}`] : []);

test('every extension file that sends debugger input does it inside driving() (a new one added without the gap fails here)', () => {
  const files = sources('extension/').filter(path => /Input\.dispatch(Mouse|Key)Event|Input\.insertText/.test(read(path)));
  assert.ok(files.length >= 3, 'positive control: the known input senders are found');
  for (const path of files) assert.match(read(path), /\bdriving\(/, `${path} sends input through the debugger without the driver gap (extension/input-gap.js): the overlay would block it`);
});

test('the overlay is invisible to hit-tests, ends on every way out, and is hidden from the picture', () => {
  const overlay = read('extension/panel-overlay.js');
  assert.match(overlay, /pointer-events:\s*none/, 'a layer that takes no hit-test: elementFromPoint, on-top and the clicks of the driver see the page');
  assert.match(overlay, /ID = 'jobpilotto-fill-overlay'/, 'its id starts with jobpilotto: every page read already skips it');
  assert.match(overlay, /chrome\.runtime\?\.id/, 'an extension reload lifts it');
  assert.doesNotMatch(overlay, /MAX_MS|EARLY_MS|setTimeout\(\(\) => lift/, 'no timer lifts it: only the worker\'s verdict (Why-changed: the three-minute backstop and the early 15 s life — owner, 27 Oct 2026, one state owner)');
  for (const path of ['extension/stop.js', 'extension/settle-tabs.js']) assert.match(read(path), /jobpilotto-fill-overlay/, `${path} removes the overlay with the other page marks`);
  assert.match(read('extension/ladder/rung4-page-picture.js'), /jobpilotto-fill-overlay/, 'the AI\'s picture never shows the dim layer');
  assert.match(read('extension/panel-files.js'), /panel-overlay\.js/);
  const markup = read('extension/panel-markup.js');
  assert.match(markup, /\.jp\.working \{ align-items: center; \}/, 'the panel is centred while filling');
  assert.doesNotMatch(markup, /\.jp\.working[^}]*\bzoom:/, 'the centred panel is the corner\'s size: no zoom (owner, 19 Oct 2026: 1.3 was too big)');
});

test('the magic behind the panel lives inside the layer, only moves transform and opacity, and stands still under reduced motion', () => {
  const fx = read('extension/panel-overlay-fx.js');
  assert.match(read('extension/panel-overlay.js'), /__jobPilottoOverlayFx\?\.\(layer\)/, 'drawn into the overlay layer: every end that removes the layer removes it');
  assert.match(fx, /prefers-reduced-motion: reduce/, 'nothing is added under reduced motion');
  assert.match(fx, /pointer-events:none/, 'takes no hit-test');
  assert.doesNotMatch(fx, /setInterval|setTimeout|requestAnimationFrame|<style|fetch\(|url\(/, 'no timers, no page <style> a CSP could refuse, no network image');
  for (const frame of fx.match(/\[\{[^\n]*\}\]/g) || []) assert.doesNotMatch(frame, /\b(left|top|width|height|margin|filter|box-shadow)\s*:/, 'animates compositor properties only');
  const markup = read('extension/panel-markup.js');
  assert.match(markup, /@media \(prefers-reduced-motion: reduce\) \{ \.jp\.working \.card \{ animation: none; \} \}/, 'the panel glow stops under reduced motion');
});

// #1558: a closed panel (its X) has no Stop on the page, so a later step must not dim and hold the page; closing it lifts the overlay.
// 27 Oct 2026 (owner: the panel stayed centred on "Reading this page…" with no dim): the dim and the centring are ONE look, set only by look(), and a lift by itself tells the panel.
test('the dim and the centring are one look: only look() sets either, a closed panel is never dimmed, and the overlay tells the panel when it lifts by itself', () => {
  const review = read('extension/review.js');
  const lookLine = review.match(/const look = [^\n]*\n/)?.[0] || '';
  assert.match(lookLine, /working && \(applyWorking \|\| filling\) && !host\.hidden/, 'look() dims only while the panel is shown (the one Stop lives on it)');
  assert.match(lookLine, /overlay\.on\(\)[^\n]*overlay\.off\(\)[^\n]*place\(on\)/, 'look() sets the dim and the centring together');
  const outside = review.replace(lookLine, '');
  assert.doesNotMatch(outside, /overlay\.(on|off)\(/, 'nothing but look() turns the dim on or off');
  assert.doesNotMatch(outside.replace(/const place = [^\n]*\n/, ''), /\bplace\(/, 'nothing but look() centres the panel or sends it back');
  assert.match(review, /\$\('\.x'\)\.onclick = \(\) => \{[^}]*look\(false\)/, 'the X lifts the look');
  assert.match(review, /overlay\.onLift\?\.\(/, 'the panel hears a lift it did not ask for (a verdict of the worker: Stop, done, your turn)');
  const overlay = read('extension/panel-overlay.js');
  // Why-changed: the layer-removed and Date.now() > until lifts went (owner, 27 Oct 2026: nothing lifts but the worker's verdict); a deleted layer is put back.
  for (const why of [/!chrome\.runtime\?\.id\) lift\(\)/, /'stopped'\) lift\(\)/, /message\.state === 'working'\) on\(\); else lift\(\)/])
    assert.match(overlay, why, `every lift the overlay does by itself goes through lift(), which tells the panel: ${why}`);
});

// 27 Oct 2026 (owner: "at the time the webpage loads, can we instantly show the overlay dark/glowing background? Right now there is a 0.5 second until it appears"): a fill page is dimmed when
// its document commits, by the same one-per-page overlay the panel then takes over, and a page that never gets a panel is not left dim.
test('a working Apply is dimmed from its commit by the one overlay the panel takes over, and only the worker\'s verdict lifts it', () => {
  const early = read('extension/early-dim.js');
  assert.match(early, /webNavigation\?\.onCommitted/, 'at the commit, the earliest moment the worker can reach the new document');
  // Why-changed: the mark-or-step rule is now the worker's state (apply-state.js): set by the app's marked open before any page loads, dimmed while working.
  assert.match(early, /includes\(FILL_MARK\)[\s\S]*applyState\(details\.tabId\)[\s\S]*setApply\(details\.tabId, WORKING\)/, 'an Apply starts at the first marked navigation of a tab with no state (or the app opening a finished tab again)');
  assert.match(early, /!isWorking\(details\.tabId\)/, 'only a tab the worker holds as working is dimmed, never any other page');
  assert.match(early, /isStopped\(\)/, 'never after the person\'s Stop');
  assert.match(early, /files: \['panel-overlay-fx\.js', 'panel-overlay\.js', 'overlay-early\.js'\]/, 'one injection: the overlay and its early start together');
  assert.match(read('extension/background.js'), /startEarlyDim\(\);/, 'the worker starts it');
  const overlay = read('extension/panel-overlay.js');
  assert.match(overlay, /if \(window\.__jobPilottoOverlay\?\.alive\?\.\(\)\) return;/, 'one copy per page: the panel\'s own injection keeps the early layer, so the panel lifts the layer it sees');
  assert.match(read('extension/review.js'), /send\(\{type: 'panelApply'\}\)[\s\S]*showStep\(answer\.text \|\| 'Starting…'\)/, 'the panel\'s first draw is the worker\'s state: working draws centred with its step, a verdict draws the finished look, no timeout in between');
});
