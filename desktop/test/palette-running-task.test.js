// ⌘K lists every task action also while it runs; choosing a running one opens its progress (owner, 18 Oct 2026: typed "find", no "Find jobs" while a search ran).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buttonEntry, reveal} from '../renderer/pages/palette-busy.js';
import {activitySource} from './activity-source.js';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const [html, nav, board] = [read('index.html'), read('pages/nav.js'), read('pages/actions-board.js')];
const entry = {group: 'Actions', label: 'Find jobs', hint: 'Reads boards', keywords: 'find', run: () => 'run'};

test('a running task stays in ⌘K, marked as running; a button off for another reason is not offered', () => {
  const busy = buttonEntry({disabled: true, dataset: {runBusy: '1'}}, entry);
  assert.equal(busy.label, 'Find jobs');
  assert.match(busy.hint, /Running now/);
  assert.equal(busy.running, true, 'a running entry carries the spinner flag');
  assert.equal(busy.enter, 'open', 'its Enter only opens the card');
  assert.equal(buttonEntry({disabled: false, dataset: {}}, entry).running, undefined);
  assert.equal(busy.run(), 'run');
  assert.equal(buttonEntry({disabled: false, dataset: {}}, entry).label, 'Find jobs');
  assert.equal(buttonEntry({disabled: true, dataset: {}}, entry), null);
});

// Enter brings you to a button; it never presses one (owner, 18 Oct 2026).
test('choosing a button entry reveals it (scroll, focus, pulse) and never clicks it', () => {
  const calls = [], classes = new Set();
  const card = {classList: {add: c => classes.add(c), remove: c => classes.delete(c)}, offsetWidth: 1, scrollIntoView: o => calls.push(`scroll ${o.block}`), addEventListener: () => {}};
  const node = {closest: () => card, focus: o => calls.push(`focus ${o.preventScroll}`), click: () => calls.push('CLICK')};
  reveal(node);
  assert.deepEqual(calls, ['scroll center', 'focus true']);
  assert.ok(classes.has('palette-flash'));
  const nav = read('pages/nav.js');
  // The Jobs view switches ("Show jobs as a board", a saved view chip) are named for what they do, so they stay a click; every other button entry only reveals.
  const pressing = nav.split('\n').filter(line => /node\.click\(\)/.test(line) && !/openView\('jobs'\); (if \(.*\) )?node\.click\(\)/.test(line));
  assert.deepEqual(pressing, [], 'a ⌘K entry presses a button: it must only reveal it');
  assert.match(read('components.css'), /\.palette-flash \{ animation: palette-flash/);
  assert.match(read('components.css'), /prefers-reduced-motion: reduce\) \{ \.palette-flash/);
});

// The class: every button that starts a tracked task (TASK_BUTTONS) has an entry, and every entry loop goes through buttonEntry, so none drops a running task.
test('every task button has a ⌘K entry, and no entry loop skips a button that is busy', () => {
  const activity = activitySource();
  const tasks = JSON.parse(activity.match(/export const TASK_BUTTONS = (\[.*\]);/)[1].replace(/'/g, '"'));
  const kinds = new Set(JSON.parse(`[${activity.match(/export const COMMAND_KIND = \{([^}]*)\}/)[1].replace(/\w+: '(\w+)'/g, '"$1"')}]`));
  const unreached = [];
  for (const [kind, ...selectors] of tasks) for (const selector of selectors) {
    const id = selector.slice(1);
    const tag = html.match(new RegExp(`<(button|input)[^>]*\\bid="${id}"[^>]*>`))?.[0] || (board.includes(`.id = '${id}'`) ? 'built <button data-palette' : '');
    if (!tag) { unreached.push(`${id} (not in the page)`); continue; }
    if (/^<input/.test(tag)) continue;   // a count field, not an action
    const own = /data-palette=|data-command=/.test(tag) || tag.startsWith('built'), twin = kinds.has(kind), listed = nav.includes(`button('`) && new RegExp(`button\\('\\w+', '${id}'`).test(nav);
    if (!own && !twin && !listed) unreached.push(id);
  }
  assert.deepEqual(unreached, []);
  assert.doesNotMatch(nav, /!node\.disabled && (add|reachable)/, 'a loop drops disabled buttons itself: a running task would vanish from ⌘K');
  assert.doesNotMatch(nav, /!node\.disabled && !node\.closest/);
  assert.equal([...nav.matchAll(/\baddNode\(node,/g)].length, 6);   // button(), both Actions card loops, the Settings sweep, the service cards, the page sweep
});

// The row's spinner is the app's own .spinner.small and the footer follows the row under the cursor (owner, 18 Oct 2026: a running row shows a spinner; Enter says "open").
test('the palette draws the shared spinner on a running row and an "Enter to open" footer', () => {
  const palette = read('palette.js');
  assert.match(palette, /command\.running\) label\.append\(.*className: 'spinner small'/);
  assert.match(palette, /Enter to \$\{shown\[active\]\?\.enter \|\| 'run'\}/);
  assert.match(read('pages/nav.js'), /\{enter: entry\.enter, running: entry\.running[,}]/);
});
