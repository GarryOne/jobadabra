// One switch for every way into Claude (claude-help.js; owner, 9 Oct 2026). The class, not the case: every renderer file that draws a Claude entry point
// (a button or menu item that starts, resumes or messages Claude) must ask claudeHelp(); a new one added without it fails here. Plus: off by default,
// the Jobs batch dialog follows saved Apply mode, and the Sessions empty state uses the extension's words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const RENDERER = new URL('../renderer/', import.meta.url);
const files = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
const ENTRY = /['"`](▶ )?(Resume Claude|Apply with Claude|Tell Claude…|Change with Claude…|Read with Claude|Let Claude finish this page)['"`]|`Reply "\$\{/;   // buttons, a menu's option, a reply to Claude

test('every renderer file that draws a Claude entry point asks the one switch', () => {
  const drawing = files(fileURLToPath(RENDERER)).filter(file => ENTRY.test(fs.readFileSync(file, 'utf8')));
  assert.ok(drawing.length >= 3, `found ${drawing.length} files`);
  // Asks the switch itself, or is told by its caller through an explicit `claude` flag (answer-options.js: session-needs.js passes claudeHelp()).
  for (const file of drawing) assert.match(fs.readFileSync(file, 'utf8'), /claudeHelp\(\)|resumeOffered\(\)|if \(claude\) /, `${path.basename(file)} draws a Claude button without claudeHelp()`);
  assert.match(fs.readFileSync(new URL('pages/session-needs.js', RENDERER), 'utf8'), /answerOptions\(need, knownAnswers, \{claude: resumeOffered\(\)\}\)/);
  const sessions = fs.readFileSync(new URL('pages/session-next-step.js', RENDERER), 'utf8');
  assert.equal((sessions.match(/actions\.push\(resume\(\)\)/g) || []).length, 1);   // only inside pushResume, which asks the switch
  assert.match(sessions, /const pushResume = \(\) => \{ if \(resumeOffered\(\)\) actions\.push\(resume\(\)\); \};/);   // the resume entry asks resumeOffered, which wraps claudeHelp (claude-help.js)
});

test('the switch is "Claude is ready" (installed + signed in), not a setting; the batch dialog has no second mode selector', async () => {
  const help = fs.readFileSync(new URL('claude-help.js', RENDERER), 'utf8');
  assert.match(help, /export const claudeHelp = \(\) => installed && claudeFeatures\(\);/);   // and the Claude family only
  const html = fs.readFileSync(new URL('index.html', RENDERER), 'utf8');
  assert.doesNotMatch(html, /name="apply-mode"/);
  assert.doesNotMatch(html, /<b>Apply with Claude<\/b> <span class="badge-recommended">/);
  assert.doesNotMatch(html, /press <b>Apply with Claude<\/b> to start one/);
  assert.match(fs.readFileSync(new URL('pages/jobs-apply.js', RENDERER), 'utf8'), /modeCards\(applyOf\(settings\)\.mode/);
});

test('the Claude install checklist is under the Settings switch too, shown only while it is on', () => {
  const html = fs.readFileSync(new URL('index.html', RENDERER), 'utf8');
  assert.match(html, /<ul class="prereqs" id="claude-prereqs-settings" hidden><\/ul>/);   // the same list style as the wizard's, hidden until the switch is on
  const prereqs = fs.readFileSync(new URL('pages/claude-prereqs.js', RENDERER), 'utf8');
  assert.match(prereqs, /inSettings\.hidden = !resumeOffered\(\);/);
  assert.match(prereqs, /for \(const list of \[\$\('claude-prereqs'\), inSettings\]/);   // one checklist, drawn in both places
  assert.match(prereqs, /window\.addEventListener\('claude-help', \(\) => showClaudePrereqs\(\)\);/);   // turned on: it shows at once
});

test('"Always let Claude finish when I\'m stuck" is a Settings switch (claudeAuto) shown only while Claude is ready; it replaced "Show Claude help"', () => {
  const html = fs.readFileSync(new URL('index.html', RENDERER), 'utf8');
  assert.match(html, /id="claude-auto-line" hidden/);
  assert.match(html, /Always let Claude finish when I'm stuck/);
  assert.doesNotMatch(html, /Show Claude help|id="claude-consent"/);
  const auto = fs.readFileSync(new URL('claude-auto.js', RENDERER), 'utf8');
  assert.match(auto, /\$\('claude-auto-line'\)\.hidden = !resumeOffered\(\);/);   // the takeover flag wraps claudeHelp
  assert.match(auto, /save\(\{claudeAuto: \$\('claude-auto'\)\.checked\}\)/);
});
