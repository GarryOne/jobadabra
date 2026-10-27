// "Resume Claude" is hidden everywhere while SHOW_RESUME_CLAUDE is off (owner, 15 Oct 2026). The class: every place that builds or offers it asks resumeOffered,
// and no text tells the person to press it. The places: the session card's button, its ⋯ menu entry, the log banner's button and the banner's wording.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const walk = dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

test('the flag is off, and resumeOffered follows it', async () => {
  globalThis.window = {pilot: {}, dispatchEvent() {}};
  const help = await import('../renderer/claude-help.js');
  assert.equal(help.SHOW_RESUME_CLAUDE, false);
  assert.equal(help.resumeOffered(), false);
});

test('every renderer line that builds or shows a Resume Claude entry is gated by resumeOffered', () => {
  const builders = [];
  for (const file of walk('renderer').filter(name => /\.js$/.test(name) && !name.endsWith('claude-help.js'))) {
    read(file).split('\n').forEach((line, index) => {
      if (/^\s*\/\//.test(line) || /const resume = \(\)/.test(line)) return;   // the builder itself: only pushResume offers it
      if (/['"`](?:▶ )?Resume Claude['"`]/.test(line) || /\bpushResume\(\)/.test(line) && !/const pushResume/.test(line) || /ss-offline-resume'\)\.hidden/.test(line)) builders.push([file, index + 1, line]);
    });
  }
  assert.ok(builders.length >= 3, 'the scan found the entries');
  for (const [file, number, line] of builders) {
    const gated = /resumeOffered\(\)/.test(line) || /pushResume = /.test(line) || /\bpushResume\(\)/.test(line);
    assert.ok(gated, `${file}:${number} offers Resume Claude without resumeOffered: ${line.trim().slice(0, 80)}`);
  }
  assert.match(read('renderer/pages/session-next-step.js'), /const pushResume = \(\) => \{ if \(resumeOffered\(\)\)/);
});

test('no text tells the person to press Resume Claude while it is hidden', () => {
  for (const file of [...walk('renderer').filter(name => /\.js$/.test(name)), 'lib/quit-dialog.js']) {
    read(file).split('\n').forEach((line, index) => {
      if (/^\s*\/\//.test(line) || /resumeOffered\(\)/.test(line) || /label: '▶ Resume Claude'/.test(line) || /sessionButton\('Resume Claude'/.test(line)) return;
      assert.doesNotMatch(line, /press Resume Claude|then Resume Claude|resume it to answer(?!.*resumeOffered)/, `${file}:${index + 1}`);
    });
  }
});

// Claude's whole takeover follows the one flag: the app side (offer, "always", countdown, the start itself, the Settings switch) and the extension panel (Report this form instead).
test('class: the takeover is off in the app and the extension reads the same flag', async () => {
  const app = (name) => read(name);
  assert.match(app('lib/claude-ready.js'), /import \{SHOW_RESUME_CLAUDE\} from '\.\.\/renderer\/claude-help\.js'/);
  assert.match(app('lib/ext-server-handlers.js'), /claudeHelp: takeoverOffered\(storage\), claudeTakeover: SHOW_RESUME_CLAUDE, claudeAlways: SHOW_RESUME_CLAUDE && /);   // the panel's reply: no second copy of the flag
  assert.match(app('lib/apply-handlers.js'), /createTakeOver\(\{enabled: SHOW_RESUME_CLAUDE,/);   // the start itself refuses while off, even from an old extension
  assert.match(app('lib/ladder/rung5-takeover.js'), /enabled = false/);
  assert.match(app('renderer/claude-auto.js'), /hidden = !resumeOffered\(\)/);
  assert.match(app('renderer/claude-offer.js'), /help: resumeOffered\(\)/);
  assert.match(fs.readFileSync(path.join(root, '..', 'extension', 'review.js'), 'utf8'), /takeover: reply\?\.claudeTakeover|claudeTakeover !== false/);
  // The panel: flag off -> the Report this form button where Claude's offer was (or "needs" when the report switch is off); flag on -> the offer as before.
  globalThis.window = {};
  await import('../../extension/panel-claude.js');
  const {next} = globalThis.window.__jobPilottoClaude;
  const info = extra => ({on: true, stuck: true, auto: true, consent: true, ...extra});
  const fresh = {phase: null, dismissed: false};
  assert.equal(next(info({takeover: false, report: true}), fresh).view, 'report');
  assert.equal(next(info({takeover: false, report: false}), fresh).view, 'needs');
  assert.equal(next(info({takeover: false, report: true, auto: true}), fresh).view, 'report', 'no countdown while the takeover is off');
  assert.equal(next(info({takeover: true}), fresh).view, 'countdown');
  assert.equal(next(info({takeover: true, auto: false}), fresh).view, 'offer');
  assert.equal(next(info({takeover: false, stuck: false}), fresh).view, 'hidden');
});

// The footer bar "Send answer" / "Send all N answers" (before 25 Oct 2026 "Send it to Claude") (need-send.js showSendBar, #ss-needs-send) is a reply to Claude too: it asks resumeOffered like the rest
// (owner, 25 Oct 2026: "Do we still have Send to Claude anywhere? That should be disabled/hidden").
test('the Send answers bar on Applying is shown only when resumeOffered()', () => {
  const code = read('renderer/pages/need-send.js');
  const at = code.indexOf('export function showSendBar');
  assert.ok(at >= 0, 'showSendBar found');
  assert.match(code.slice(at, at + 400), /show\(bar, resumeOffered\(\) && /);
  assert.match(read('renderer/index.html'), /id="ss-needs-send" hidden/, 'the bar starts hidden');
});
