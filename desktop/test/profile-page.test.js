// Profile is its own page (owner, 18 Oct 2026, UI redesign fix 9 + 10): every way in (the menu's Profile, Settings → Profile, Overview's Edit profile, ⌘K)
// passes settingsPage('profile'), which drops "Settings", its list of sections and the second heading; one save bar for the 5 tabs; Fill from my CV and the
// one "View source in Notion" sit in a quiet ⋯ menu; the assistant moved to Automation and the old password lives only in Credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const page = name => { const from = html.indexOf(`data-settings-page="${name}"`); return html.slice(from, html.indexOf('data-settings-page="', from + 30)); };
const files = dir => fs.readdirSync(new URL(`../renderer/${dir}`, import.meta.url), {withFileTypes: true})
  .flatMap(entry => entry.isDirectory() ? (entry.name === 'vendor' ? [] : files(`${dir}${entry.name}/`)) : /\.js$/.test(entry.name) ? [`${dir}${entry.name}`] : []);

test('settingsPage puts Settings in profile mode for Profile only, and the CSS drops Settings\' heading and list there', () => {
  const settings = read('pages/settings.js');
  const body = settings.slice(settings.indexOf('export function settingsPage('), settings.indexOf('export function openSetting('));
  assert.match(body, /classList\.toggle\('is-profile', name === 'profile'\)/);
  const css = read('profile-page.css');
  assert.match(css, /\.is-profile > \.view-head,\n\.view\[data-view="settings"\]\.is-profile \.settings-nav \{ display: none; \}/);
  assert.match(html, /href="profile-page\.css"/);
  assert.match(page('profile'), /<h1>Profile<\/h1>/, 'Profile has its own heading');
});

test('class: every way into Profile goes through settingsPage, and only settingsPage shows a Settings page', () => {
  assert.match(read('pages/nav.js'), /if \(nav\.dataset\.view === 'settings'\) settingsPage\(nav\.dataset\.settings \|\| 'overview'\);/, 'the menu\'s Profile (and its Settings = Overview)');
  assert.match(read('pages/settings.js'), /if \(go\) \{ settingsPage\(go\.dataset\.settingsGo\);/, 'Settings → Profile');
  assert.match(read('pages/settings.js'), /\$\('ov-profile'\)\.addEventListener\('click', \(\) => settingsPage\('profile'\)\)/, 'Overview\'s Edit profile');
  assert.match(read('pages/nav.js'), /`Open Profile: \$\{labelOf\(tab\)\}`[^\n]*\n\s*\(\) => \{ openView\('settings'\); settingsPage\('profile'\);/, '⌘K Open Profile: <tab>');
  const showers = files('').filter(file => /show\([^)]*settingsPage ===/.test(read(file)));
  assert.deepEqual(showers, ['pages/settings.js'], 'a Settings page is shown only by settingsPage');
  assert.match(html, /<button class="nav" data-view="settings" data-settings="profile">/);
  assert.doesNotMatch(html, /data-settings-go="profile"/, 'Settings\' side menu does not list Profile (the main menu does)');
});

test('the Profile bar names the 5 tabs as the tab strip does', () => {
  const tabs = [...page('profile').matchAll(/data-profile-tab="(\w+)"[^>]*>([^<]+)</g)].map(([, key, label]) => [key, label]);
  assert.equal(tabs.length, 5);
  const bar = read('pages/profile-save-bar.js');
  for (const [key, label] of tabs) assert.match(bar, new RegExp(`${key}: '${label}'`), `${key} → ${label}`);
  assert.match(read('pages/settings.js'), /profileBar\(\)\.leave\(/, 'leaving Profile for another Settings page asks');
  assert.match(read('pages/profile.js'), /guardLeave\('settings', proceed =>[^\n]*profileBar\(\)\.leave\(proceed\)\)/, 'leaving the Settings view from Profile asks');
});

test('fix 10: Fill from my CV and the one View source in Notion are in a quiet ⋯ menu and in ⌘K; no orange link on the Contact card', () => {
  const menu = read('pages/profile-menu.js');
  assert.match(menu, /label: 'Fill empty details from my CV'/);
  assert.match(menu, /if \(shared\.state\?\.notion\?\.NOTION_PROFILE_PAGE_ID\) items\.push\(\{label: 'View source in Notion'/);
  assert.match(page('profile'), /<span id="profile-more"><\/span>/);
  assert.ok(!/id="contact-from-cv"|id="open-profile-details"/.test(html));
  const nav = read('pages/nav.js');
  assert.match(nav, /add\('Settings', 'Fill my details from my CV'/);
  assert.match(nav, /add\('Notion', 'Profile: View source in Notion'/);
});

test('fix 5: the assistant is on Settings → Apply (moved there 26 Oct 2026, hybrid fill step 2), the old password only in Credentials', () => {
  assert.match(page('apply'), /id="setting-claude"/);
  assert.ok(!page('profile').includes('setting-claude'));
  assert.ok(!html.includes('site-password-line'), 'the copy on Your details is gone');
  assert.match(page('credentials'), /id="credentials-shared-show"/);
});

test('a move within Settings never passes through Overview, so going back to Profile from Profile never asks about its drafts', () => {
  // openView('settings') used to start on Overview every time: the menu's Profile or ⌘K "Open Profile: …" while on Profile with drafts went
  // Profile → Overview → Profile and the leave question popped up on the way (seen in the PR 2 render, 18 Oct 2026).
  const nav = read('pages/nav.js');
  const branch = nav.slice(nav.indexOf("if (name === 'settings') {"), nav.indexOf('showServicesNow();'));
  assert.match(branch, /if \(leaving !== 'settings'\) settingsPage\('overview'\);/);
  assert.doesNotMatch(branch.replace(/if \(leaving !== 'settings'\) settingsPage\('overview'\);/, ''), /settingsPage\(/);
});

// The class (owner, 18 Oct 2026: "remove Profile from the Settings side menu"): a Settings link needs a section behind it, and no link may lead to the old Settings → Profile.
test('class: every data-settings-go value has a Settings section, and none is Profile', () => {
  const sections = new Set([...html.matchAll(/data-settings-page="([a-z-]+)"/g)].map(match => match[1]));
  const gos = [...html.matchAll(/data-settings-go="([a-z-]+)"/g)].map(match => match[1]);
  assert.ok(gos.length >= 8, 'the links are found');
  for (const go of gos) assert.ok(sections.has(go), `data-settings-go="${go}" has a section`);
  assert.ok(!gos.includes('profile'), 'no Settings link to Profile');
  assert.ok(sections.has('profile'), 'the Profile page itself stays');
});
