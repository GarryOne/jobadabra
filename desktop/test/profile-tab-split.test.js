// Profile → "CV & details" splits into CV and Your details (owner, 17 Oct 2026: "CV separate, Experience separate too"; spec
// docs/superpowers/specs/2026-10-17-base-facts.md). The class, not the case: every tab has panels, every panel names a tab, ⌘K reaches every tab and
// every section on a tab that is not open, and no screen still says "CV & details". Strategy keeps its one-word sidebar label; its page title reads
// "Search strategy" (owner: "Strategy (+ page title 'Search strategy')").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('renderer/index.html');
const tabs = [...html.matchAll(/data-profile-tab="(\w+)"[^>]*>([^<]+)</g)].map(match => [match[1], match[2].replace('&amp;', '&')]);
const panels = [...html.matchAll(/id="([\w-]+)"[^>]*data-profile-panel="(\w+)"/g)].map(match => [match[1], match[2]]);
const panelOf = id => panels.find(([each]) => each === id)?.[1];

test('five tabs, CV first, then Your details; no Preferences tab (owner, 17 Oct 2026; 28 Oct 2026: Application answers is "What we learned")', () => {
  assert.deepEqual(tabs, [['cv', 'CV'], ['details', 'Your details'], ['experience', 'Experience'], ['answers', 'What we learned'], ['letter', 'Cover letter']]);
});

test('the CV parts sit on CV, your details on Your details', () => {
  for (const id of ['setting-cv', 'setting-cvcheck', 'cv-changed']) assert.equal(panelOf(id), 'cv', id);
  for (const id of ['setting-contact', 'setting-links']) assert.equal(panelOf(id), 'details', id);
});

test('every tab has a panel, and every panel names a tab', () => {
  const keys = tabs.map(([key]) => key);
  for (const key of keys) assert.ok(panels.some(([, tab]) => tab === key), `the tab "${key}" shows nothing`);
  for (const [id, tab] of panels) assert.ok(keys.includes(tab), `${id} names a tab that does not exist: ${tab}`);
});

test('CV is the first-window fallback and draws the CV; Your details keeps unsaved edits', () => {
  const settings = read('renderer/pages/settings.js'), profile = read('renderer/pages/profile.js');
  assert.match(settings, /profileTab\(remembered\('profileTab'\) \|\| 'cv', \{byDefault: true\}\)/);
  assert.match(profile, /else if \(name === 'cv'\) \{ loadCvSetting\(\); showCvChanged\(\); \}/);
  assert.doesNotMatch(profile.match(/export function profileTab[\s\S]*?\n}/)[0], /showContact/, 'switching to Your details never redraws it: unsaved edits stay');
});

// 17 Oct 2026: with CV the default tab, the closed Your details panel was "hidden" and the CV's proposals filled none of its boxes (main filled 4).
test('Fill from my CV fills Your details while its tab is closed; a box the form hides stays skipped', () => {
  const page = read('renderer/pages/contact-proposals.js');
  assert.match(page, /hiddenByForm = input => \{ const hidden = input\.parentElement\?\.closest\('\[hidden\]'\); return Boolean\(hidden && !hidden\.matches\('\[data-profile-panel\]'\)\); \}/);
  assert.match(page, /input\.value\.trim\(\) \|\| hiddenByForm\(input\)\) continue;/);
  assert.match(html, /<label data-swiss-only hidden>Place of origin/, 'the box the form hides is still marked hidden');
});

test('⌘K lists every Profile tab, and a section on a closed tab opens that tab first', () => {
  const nav = read('renderer/pages/nav.js');
  assert.match(nav, /\[data-profile-tab\]/, 'each tab is a ⌘K entry');
  assert.match(nav, /profileTab\(section\.dataset\.profilePanel\)/, 'a section entry switches to its tab');
  assert.match(nav, /onClosedTab\(section\) \|\| onClosedPanel\(section\)\) && hiddenAt\(node\) === section/, 'a section on a closed tab is still listed, with its buttons');
});

test('no screen or message still says "CV & details"', () => {
  for (const file of ['renderer/index.html', 'renderer/pages/experience.js', 'lib/experience-handlers.js']) {
    assert.doesNotMatch(read(file), /CV (&|&amp;) details/, file);
  }
});

test('Strategy: one word in the sidebar, "Search strategy" as the page title', () => {
  assert.match(html, /data-view="strategy"><i data-icon="sliders"><\/i>Strategy</);
  assert.match(html, /<header class="view-head"><div><h1>Search strategy<\/h1>/);
});
