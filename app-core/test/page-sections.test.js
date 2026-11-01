// Collapsed form sections (extension/sections.js): opened by STRUCTURE before the form is read. The shape of SuccessFactors' application page
// (9 Oct 2026: "Informations sur le profil" collapsed, its fields not shown until opened, so the fill saw no form), Workday's and many
// accordion forms. Never a popup, menu, navigation, header, link, submit; a page with nothing to fill is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';
import { openClosedSections } from '../../extension/sections.js';

const JSDOM = await loadJsdom();
const run = (window) => window.eval(`(${openClosedSections.toString()})()`);

// A heading-button disclosure (the sections of the page), as the site's own script behaves: a click shows the region and flips aria-expanded.
const section = (id, title, body) => `<div><h2><button id="${id}-top" aria-expanded="false" aria-controls="${id}-body" class="top">${title}</button></h2>
  <div id="${id}-body" hidden>${body}</div></div>`;
const WIRE = `document.addEventListener('click', e => { const b = e.target.closest('button[aria-controls]'); if (!b) return;
  const region = document.getElementById(b.getAttribute('aria-controls')); region.hidden = false; b.setAttribute('aria-expanded', 'true'); });`;

const PAGE = `<header><button id="menu" aria-expanded="false">Menu</button></header>
<nav><button id="navtoggle" aria-expanded="false">More</button></nav>
<form>
  <label for="email">E-mail *</label><input id="email" required>
  ${section('profile', 'Profile information', '<label for="phone">Phone *</label><input id="phone" required>')}
  ${section('job', 'About the job', '<label for="why">Why us *</label><textarea id="why" required></textarea>')}
  <details id="more"><summary>More about you</summary><label for="city">City</label><input id="city"></details>
  <button id="filter" aria-expanded="false" aria-haspopup="listbox">Filter</button>
  <button id="plain" aria-expanded="false">Not a disclosure</button>
  <a id="link" href="/elsewhere" role="button" aria-expanded="false">A link</a>
  <button id="send" type="submit" aria-expanded="false">Send</button>
</form>`;

test('collapsed sections are opened by structure: heading buttons and closed details, never a popup, menu, nav, link, submit or a plain button', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, PAGE);
  window.eval(WIRE);   // jsdom here runs no inline script: the site's own click handling is added the same way
  const clicked = [];
  window.document.addEventListener('click', (e) => clicked.push(e.target.id), true);
  const opened = run(window);
  assert.equal(opened, 3, 'two heading sections and one closed details');
  assert.equal(window.document.getElementById('profile-body').hidden, false);
  assert.equal(window.document.getElementById('job-body').hidden, false);
  assert.equal(window.document.getElementById('more').open, true);
  for (const id of ['menu', 'navtoggle', 'filter', 'plain', 'link', 'send']) assert.ok(!clicked.includes(id), `${id} is not touched`);
  assert.equal(run(window), 0, 'a second look finds nothing left, nothing is pressed twice');
});

test('a page with no form control is left alone', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, `<main>${section('faq', 'Frequently asked questions', '<p>Answers</p>')}</main>`);
  window.eval(WIRE);
  assert.equal(run(window), 0);
  assert.equal(window.document.getElementById('faq-body').hidden, true);
});

test('a section that holds a submit control is never opened, and no more than 20 are opened in a round', { skip: !JSDOM }, () => {
  const sections = Array.from({ length: 25 }, (_, i) => section(`s${i}`, `Section ${i}`, `<input id="f${i}">`)).join('');
  const window = openPage(JSDOM, `<form>${section('final', 'Review and send', '<button type="submit">Send</button>')}${sections}</form>`);
  window.eval(WIRE);
  assert.equal(run(window), 20);
  assert.equal(window.document.getElementById('final-body').hidden, true, 'the section with the submit stays closed');
});
