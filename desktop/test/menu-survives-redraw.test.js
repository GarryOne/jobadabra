// A list that redraws (Jobs on a sessions update, Interviews when a read finishes) must not close the ⋯ menu a person has open on one of its rows
// (owner, 31 Oct 2026, nightly beta run 41162490590: the menu closed under the cursor while "Application sessions: 2 active" updated).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const {moreButton, closeMenu, holdMenu} = await import('../renderer/components.js');
const menu = () => body.querySelector('.ui-menu');
// What a page does: hold the menu, replace its rows, restore it.
const redrawKeepingMenu = (within, keyAttr, redraw) => { const restore = holdMenu(within, keyAttr); redraw(); restore(); };
const make = tag => globalThis.document.createElement(tag);

// A page with a list of rows keyed by data-url, each with its own ⋯; `draw` is its redraw (replaces every row, as pages/jobs-render.js does).
function page(urls) {
  const view = make('section'), list = make('div'), ran = [];
  view.append(list); body.append(view);
  const draw = () => list.replaceChildren(...urls.map(url => {
    const row = make('article'); row.dataset.url = url;
    row.append(moreButton([{label: 'Tailor CV', run: () => ran.push(`tailor ${url}`)}, {label: 'Dismiss', run: () => ran.push(`dismiss ${url}`)}]));
    return row;
  }));
  const rowOf = url => list.children.find(row => row.dataset.url === url);
  draw();
  return {view, draw, ran, rowOf, drop: url => urls.splice(urls.indexOf(url), 1)};
}

test('an open ⋯ menu stays open, on the new row of the same job, when the list redraws', () => {
  const p = page(['https://a.example/1', 'https://b.example/2']);
  const before = p.rowOf('https://b.example/2').querySelector('.ui-more');
  before.click();
  assert.equal(menu().hidden, false);
  redrawKeepingMenu(p.view, 'url', p.draw);
  const after = p.rowOf('https://b.example/2').querySelector('.ui-more');
  assert.notEqual(after, before, 'the redraw replaced the row');
  assert.equal(menu().hidden, false, 'the menu is still open');
  assert.equal(after.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(menu().querySelectorAll('button').map(b => b.textContent), ['Tailor CV', 'Dismiss']);
  menu().querySelectorAll('button')[0].click();   // its item still works, on the job that was redrawn
  assert.deepEqual(p.ran, ['tailor https://b.example/2']);
  assert.equal(menu().hidden, true);
});

test('a redraw with no menu open opens none; a redraw that drops the row closes the menu', () => {
  const p = page(['https://a.example/1', 'https://b.example/2']);
  closeMenu();
  redrawKeepingMenu(p.view, 'url', p.draw);
  assert.equal(menu().hidden, true);
  p.rowOf('https://a.example/1').querySelector('.ui-more').click();
  p.drop('https://a.example/1');
  redrawKeepingMenu(p.view, 'url', p.draw);
  assert.equal(menu().hidden, true, 'its job is gone: nothing to anchor to');
});

test('a menu open on another page is left alone', () => {
  const jobs = page(['https://a.example/1']), other = page(['https://c.example/3']);
  other.rowOf('https://c.example/3').querySelector('.ui-more').click();
  redrawKeepingMenu(jobs.view, 'url', jobs.draw);
  assert.equal(menu().hidden, false);
  assert.equal(other.rowOf('https://c.example/3').querySelector('.ui-more').getAttribute('aria-expanded'), 'true');
  closeMenu();
});

test('a row with no key closes the menu; two rows with one key reopen on the same one; no page element is not an error', () => {
  const p = page(['', 'https://a.example/1', 'https://a.example/1']);
  p.view.querySelectorAll('article')[0].querySelector('.ui-more').click();
  redrawKeepingMenu(p.view, 'url', p.draw);
  assert.equal(menu().hidden, true, 'no key: not reopened on whichever empty row comes first');
  p.view.querySelectorAll('article')[2].querySelector('.ui-more').click();
  redrawKeepingMenu(p.view, 'url', p.draw);
  assert.equal(p.view.querySelectorAll('article')[2].querySelector('.ui-more').getAttribute('aria-expanded'), 'true');
  assert.equal(p.view.querySelectorAll('article')[1].querySelector('.ui-more').getAttribute('aria-expanded'), 'false');
  redrawKeepingMenu(null, 'url', () => {});   // a view that is not on the page: closes any menu, as closeMenu(null) did
  assert.equal(menu().hidden, true);
});

test('holdMenu then restore, as the pages call it: the menu is closed while the rows are replaced and open again after', () => {
  const p = page(['https://a.example/1']);
  p.rowOf('https://a.example/1').querySelector('.ui-more').click();
  const restore = holdMenu(p.view, 'url');
  assert.equal(menu().hidden, true);
  p.draw();
  restore();
  assert.equal(menu().hidden, false);
  assert.equal(p.rowOf('https://a.example/1').querySelector('.ui-more').getAttribute('aria-expanded'), 'true');
  closeMenu();
});

// Gitar on #2670: openMenu focuses the first item; a person who tabbed out to the filter box and types must keep the caret there through each redraw.
test('focus outside the menu (the filter box) stays there when the menu reopens', () => {
  const p = page(['https://a.example/1']), box = make('input'), focused = [];
  body.append(box);
  box.focus = () => focused.push('box');
  const button = () => p.rowOf('https://a.example/1').querySelector('.ui-more');
  button().click();
  globalThis.document.activeElement = box;
  redrawKeepingMenu(p.view, 'url', p.draw);
  assert.equal(menu().hidden, false);
  assert.deepEqual(focused, ['box']);
  closeMenu();
  globalThis.document.activeElement = undefined;
});

// The class: every list that redraws its rows on a background update goes through the one helper, never a bare closeMenu() before replaceChildren.
test('Jobs and Interviews hold the menu before they clear their rows and restore it after', () => {
  const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');
  for (const [file, view, key] of [['jobs-render.js', 'jobs', 'url'], ['interviews.js', 'interviews', 'id']]) {
    const source = read(file);
    const held = source.indexOf(`holdMenu(document.querySelector('.view[data-view="${view}"]'), '${key}')`);
    assert.ok(held > 0, `${file} holds the menu`);
    assert.ok(source.indexOf('restoreMenu();', held) > held, `${file} restores it after the draw`);
    assert.doesNotMatch(source, /\bcloseMenu\(/, `${file}: a bare closeMenu on redraw closes the menu the person has open`);
  }
});
