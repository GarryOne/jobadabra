// The ⌘K palette is how a person finds an action without knowing which page it is on. An Actions card whose Run button is neither a Telegram command (data-command)
// nor declared for the palette (data-palette) is invisible there (5 Oct 2026: "Tailor CVs for top matches" was missing from ⌘K).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {activitySource} from './activity-source.js';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'index.html'), 'utf8');

test('every Run button on an Actions card is in the command palette', () => {
  const cards = [...html.matchAll(/<div class="task-card[ "][^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)].map(match => match[1]);
  assert.ok(cards.length >= 5, 'the Actions cards were not found');
  const missing = cards.filter(card => /class="[^"]*\baction\b/.test(card) && !/data-command="\w+"|data-palette="\w+"/.test(card)).map(card => card.match(/<b>([^<]+)<\/b>/)?.[1]);
  assert.deepEqual(missing, []);
});

// ⌘K right after Esc opens the palette again: the shortcut asks whether a palette is OPEN, not whether one is still in the page (6 Oct 2026: a closed one
// is removed a moment later, by its close event, and a ⌘K in between closed the closed one instead of opening it).
test('the ⌘K shortcut toggles on an open palette, not on a palette element', () => {
  const nav = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
  assert.match(nav, /if \(\$\('palette'\)\?\.open\) \$\('palette'\)\.close\(\); else openPalette/);
});

// One entry per task: a button elsewhere that starts what an Actions card starts (TASK_BUTTONS) is left out of ⌘K, in both the hand-listed buttons and the
// Settings sweep (6 Oct 2026: "Refresh jobs" and "Check for new jobs" were listed side by side and ran the same jobs check).
test('a button that starts a task an Actions card offers is not listed twice in ⌘K', async () => {
  const nav = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
  const activity = activitySource();
  const buttons = JSON.parse(activity.match(/export const TASK_BUTTONS = (\[.*\]);/)[1].replace(/'/g, '"'));
  const carded = new Set([...html.matchAll(/class="[^"]*\baction\b[^"]*" data-command="(\w+)"/g)].map(match => match[1]));
  assert.ok(carded.has('run') && carded.has('mail'), 'the Actions cards were not found');
  const builtInJs = fs.readFileSync(new URL('../renderer/pages/actions-board.js', import.meta.url), 'utf8');   // cards built by script, not in index.html (which may only shrink): "Read this board"
  for (const [kind, ...selectors] of buttons) for (const selector of selectors) assert.ok(html.includes(`id="${selector.slice(1)}"`) || builtInJs.includes(`.id = '${selector.slice(1)}'`), `${kind}: ${selector} is not in the page`);
  assert.match(nav, /if \(node && !twins\.has\(node\)/);                         // button(view, id, …)
  assert.match(nav, /filter\(node => reachable\(node, section\) && !twins\.has\(node\)\)/);   // the Settings sweep (a section on a closed Profile tab too)
  assert.match(nav, /if \(danger && buttons\.length === 1\) return;/);   // a section's sole danger button is its own entry ("Reset Jobadabra" was listed twice)
});

// The class (owner, 6 Oct 2026: Run was turned off for Tailor CVs only, then for the other cards when asked again): every Run on an Actions card that starts a
// tracked task is turned off while that task runs or waits, through the one switch (runs-page.js syncRunButtons: data-command via COMMAND_KIND, the rest via
// TASK_BUTTONS). A new card that starts a task without being reachable there fails here. Tune only opens a dialog (no task), so it is the one left out.
const NOT_A_TASK = new Set(['tune-open']);
test('every Actions Run that starts a task is turned off while it runs, through syncRunButtons', () => {
  const activity = activitySource();
  const commandKind = Object.fromEntries([...activity.match(/export const COMMAND_KIND = \{([^}]*)\}/)[1].matchAll(/(\w+): '(\w+)'/g)].map(match => [match[1], match[2]]));
  const taskIds = new Set(JSON.parse(activity.match(/export const TASK_BUTTONS = (\[.*\]);/)[1].replace(/'/g, '"')).flatMap(([, ...selectors]) => selectors.map(s => s.slice(1))));
  const runs = [...html.matchAll(/<button [^>]*\baction\b[^>]*>(?:(?!<\/button>)[\s\S])*Run<\/button>/g)].map(match => match[0]);
  assert.ok(runs.length >= 6, `the Actions Run buttons were not found (${runs.length})`);
  const unreached = runs.map(button => ({id: /id="([\w-]+)"/.exec(button)?.[1], command: /data-command="(\w+)"/.exec(button)?.[1]}))
    .filter(({id, command}) => !NOT_A_TASK.has(id) && !(command && commandKind[command]) && !taskIds.has(id)).map(({id, command}) => id || command);
  assert.deepEqual(unreached, [], 'these Run buttons stay pressable while their task runs: add them to TASK_BUTTONS or COMMAND_KIND');
  const runsPage = fs.readFileSync(new URL('../renderer/pages/runs-page.js', import.meta.url), 'utf8');
  assert.match(runsPage, /for \(const node of document\.querySelectorAll\('\.action\[data-command\]'\)\) if \(COMMAND_KIND\[node\.dataset\.command\]\) set\(node, COMMAND_KIND\[node\.dataset\.command\]\);/);
  assert.match(runsPage, /for \(const \[kind, \.\.\.selectors\] of TASK_BUTTONS\) for \(const selector of selectors\) set\(document\.querySelector\(selector\), kind\);/);
});

// ⌘K offers what can be pressed now, and a task that is running (palette-busy.js, owner 18 Oct 2026): a card whose Run is off for another reason is not listed,
// one that is off because its task runs is listed and opens the run (palette-running-task.test.js), in both card loops.
test('both Actions card loops go through buttonEntry, which drops a button that is off for another reason', () => {
  const nav = fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
  for (const attr of ['data-command', 'data-palette']) assert.match(nav, new RegExp(`querySelectorAll\\('\\.action\\[${attr}\\]'\\)\\.forEach\\(node => addNode\\(node, 'Actions'`));
});
