// Guard: a page that can be hidden (Interviews, Reports, Employers; Calendar is a tab of Interviews) is never opened by a direct .nav click; steps go through lib/go-view.mjs (CI, 17 Oct 2026: two Windows interactions steps timed out on a hidden button).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const HIDEABLE = /(interviews|reports|employers|calendar)/;
const html = fs.readFileSync(path.join(root, '..', 'renderer', 'index.html'), 'utf8');
// The buttons of the task cards inside the collapsed More group (Actions page), read from the page itself: their ids and data-command values.
const moreBlock = html.slice(html.indexOf('id="actions-more-list"'), html.indexOf('class="card runs-card"'));
export const MORE_BUTTONS = [...moreBlock.matchAll(/<button class="secondary action"([^>]*)>/g)].flatMap(([, attrs]) => [...[attrs.match(/ id="([^"]+)"/)].filter(Boolean).map(m => `#${m[1]}`), ...[attrs.match(/data-command="([^"]+)"/)].filter(Boolean).map(m => `data-command="${m[1]}"`)]);
const files = ['lib', 'suites'].flatMap(dir => fs.readdirSync(path.join(root, dir)).filter(name => name.endsWith('.mjs')).map(name => path.join(dir, name))).filter(file => file !== path.join('lib', 'go-view.mjs'));

// Lines that press a nav button for a page chosen at run time (an interpolated name) or for a hideable page by name.
export const directNavClicks = text => text.split('\n').map((line, at) => ({line, at: at + 1})).filter(({line}) => /\.click\(/.test(line) && /\.nav\[data-view=/.test(line) && (/\.nav\[data-view=["']?\$\{/.test(line) || new RegExp(`\\.nav\\[data-view=["']?${HIDEABLE.source}`).test(line)));

test('no step presses a nav button for a page chosen at run time or for a page that can be hidden', () => {
  const found = files.flatMap(file => directNavClicks(fs.readFileSync(path.join(root, file), 'utf8')).map(({line, at}) => `${file}:${at}: ${line.trim().slice(0, 100)}`));
  assert.deepEqual(found, [], `use goView(page, view) from lib/go-view.mjs:\n${found.join('\n')}`);
});

// A press of a task button that sits under More, or of one chosen at run time (data-command=${...}), outside lib/task-card.mjs.
export const directTaskClicks = text => text.split('\n').map((line, at) => ({line, at: at + 1})).filter(({line}) => /\.click\(/.test(line) && (/data-command=\\?["']?\$\{/.test(line) || MORE_BUTTONS.some(sel => line.includes(sel))));

test('no step presses a task button that can sit under More without opening More first', () => {
  assert.ok(MORE_BUTTONS.length >= 1, `the page's More group lists ${MORE_BUTTONS.join(', ')}`);
  const found = files.filter(file => file !== path.join('lib', 'task-card.mjs')).flatMap(file => directTaskClicks(fs.readFileSync(path.join(root, file), 'utf8')).map(({line, at}) => `${file}:${at}: ${line.trim().slice(0, 100)}`));
  assert.deepEqual(found, [], `use pressTask(page, selector) from lib/task-card.mjs:\n${found.join('\n')}`);
});

test('the task scan catches the shapes it is for', () => {
  assert.equal(directTaskClicks('await page.click(`[data-command="${command}"]`);').length, 1);
  assert.equal(directTaskClicks("await page.click('#visits-run');").length, 1);
  assert.equal(directTaskClicks("await page.click('[data-command=\"run\"]');").length, 0);
});

test('the scan catches the shapes it is for', () => {
  assert.equal(directNavClicks('await page.click(`.nav[data-view="${view}"]`);').length, 1);
  assert.equal(directNavClicks("await page.click('.nav[data-view=\"reports\"]');").length, 1);
  assert.equal(directNavClicks("await page.click('.nav[data-view=\"jobs\"]');").length, 0);
});

// #1690: Profile is a menu button with data-view="settings" too, so a bare `.nav[data-view="settings"]` pressed Profile and the "settings-narrow" shot showed the Profile page.
test('goView opens every menu page by one button of its own, Settings never Profile', async () => {
  const {navSelector} = await import('../lib/go-view.mjs');
  const views = [...new Set([...html.matchAll(/<button class="nav(?: [^"]*)?"([^>]*)>/g)].map(([, attrs]) => attrs.match(/data-view="([^"]+)"/)?.[1]).filter(Boolean))];
  assert.ok(views.includes('settings') && views.includes('jobs'));
  for (const view of views) {
    const wanted = navSelector(view);
    const buttons = [...html.matchAll(/<button class="nav(?: [^"]*)?"([^>]*)>/g)].filter(([, attrs]) => attrs.includes(`data-view="${view}"`) && !(wanted.includes(':not([data-settings') && /data-settings=/.test(attrs)));
    assert.equal(buttons.length, 1, `${wanted} must match exactly one menu button (matched ${buttons.length})`);
  }
  assert.match(navSelector('settings'), /:not\(\[data-settings/);
});
