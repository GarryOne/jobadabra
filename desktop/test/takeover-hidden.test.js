// Everything around Claude's takeover is hidden while the ONE flag is off (owner, 25 Oct 2026: "we don't want takeover for sure. Everything around Claude-in-Chrome or
// Resume Claude that shows the terminal, or Takeover with Claude should be hidden/disabled"). The class: no renderer file gates a Claude surface with claudeHelp() alone
// (that is "Claude Code is installed", which stays true on the owner's Mac); each asks resumeOffered() = the flag AND claudeHelp(). Sibling guards: resume-hidden,
// claude-asks-hidden, apply-with-claude-hidden, claude-help.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const root = path.resolve(import.meta.dirname, '..', 'renderer');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const walk = dir => fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const code = file => read(file).split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');

test('no renderer file gates a Claude surface with claudeHelp() alone', () => {
  const files = walk('.').filter(name => /\.js$/.test(name) && !name.endsWith('claude-help.js'));
  assert.ok(files.length > 100, 'the scan found the renderer');
  for (const file of files) assert.doesNotMatch(code(file).replace(/\/\/.*$/gm, ''), /(?<![\w.])claudeHelp\(\)/, `${file} calls claudeHelp(): ask resumeOffered() (claude-help.js)`);
});

// Every surface, where it lives, and the gate it asks (the screen, the Jobs list, Activity, the session page, Settings; the palette and tray read the same functions).
const SURFACES = [
  ['Read with Claude, per site (Activity)', 'pages/activity-visits.js', /const claude = resumeOffered\(\)/],
  ['Read the stopped sites with Claude (Activity)', 'pages/activity-visits.js', /stopped\.length > 1 && resumeOffered\(\)/],
  ['Read with Claude on a finished run (Activity)', 'pages/activity-basics.js', /site\.url && resumeOffered\(\)/],
  ['The Claude terminal on the session page', 'pages/session-steps.js', /terminalShown = item => \(resumeOffered\(\)/],
  ['The session steps instead of the terminal', 'pages/session-steps.js', /const steps = !\(resumeOffered\(\)/],
  ['A Claude session\'s Continue / View session on Jobs', 'pages/jobs-render.js', /jobsState\.claudeReady && resumeOffered\(\) \? sessionFor/],
  ['Apply with Claude in the ⋯ menu on Jobs', 'pages/jobs-render.js', /if \(jobsState\.claudeReady && resumeOffered\(\)\)/],
  ['Resume Claude (session menu)', 'pages/sessions.js', /resumeOffered\(\)\) menu\.push\(\{label: '▶ Resume Claude'/],
  ['Tell Claude / Change with Claude (Needs your attention)', 'pages/session-needs.js', /claude: resumeOffered\(\)/],
  ['Send answers to a Claude session (footer bar)', 'pages/need-send.js', /show\(bar, resumeOffered\(\) &&/],
  ['A typed answer goes to Claude only as a fallback (Needs your attention)', 'pages/need-send.js', /if \(resumeOffered\(\)\) \{ queue\(/],
  ['Claude in Chrome prerequisites (Settings, setup)', 'pages/claude-prereqs.js', /inSettings\.hidden = !resumeOffered\(\)/],
  ['"Always let Claude finish" line', 'claude-auto.js', /hidden = !resumeOffered\(\)/],
];
test('each Claude surface asks the takeover flag', () => {
  for (const [name, file, gate] of SURFACES) assert.match(read(file), gate, `${name}: ${file} does not ask resumeOffered()`);
});
