// Settings → Profile's tabs (index.html + pages/profile.js): Application answers (the standard answers + Form knowledge,
// merged 16 Oct 2026) and Strategy's Job preferences are drawn from their texts' outlines on every store; no textarea; every Notion button is Notion-only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../renderer/index.html'), profile = read('../renderer/pages/profile.js');
const page = html.slice(html.indexOf('data-settings-page="profile"'), html.indexOf('data-settings-page="automation"'));

test('the tabs: What we learned opens its outline tab, the old Preferences name opens Strategy; Form knowledge is a section, its old tab name still lands there', () => {
  assert.doesNotMatch(html, /data-profile-tab="profiletext"/, 'the Preferences tab is gone');
  assert.match(html, /data-profile-tab="answers">What we learned</);
  assert.doesNotMatch(html, /data-profile-tab="knowledge"/);
  assert.match(profile, /if \(name === 'knowledge'\) name = 'answers';/);
  assert.match(profile, /if \(name === 'answers'\) loadApplicationAnswers\(\);/, 'no Profile facts used in forms card (owner, 28 Oct 2026)');
  assert.match(profile, /if \(name === 'profiletext'\) \{ openJobPreferences\(\); return; \}/, 'its old name opens Strategy → Job preferences');
  for (const [file, texts] of [['application-answers', '\\[TEXT\\]'], ['job-preferences', '\\[TEXT\\]']]) {   // site rules are not drawn on Profile (owner, 28 Oct 2026)
    assert.match(read(`../renderer/pages/${file}.js`), new RegExp(`outlineTab\\('\\w+', ${texts}`), file);
  }
});

test('no textarea anywhere on the Profile page\'s texts (owner, 16 Oct 2026)', () => {
  for (const file of ['outline-tab', 'application-answers', 'website-rules', 'job-preferences', 'experience-profile']) {
    assert.doesNotMatch(read(`../renderer/pages/${file}.js`), /'textarea'/, file);
  }
  assert.doesNotMatch(page.slice(page.indexOf('id="setting-answers"')), /<textarea/);
});

test('every Notion button on the Profile page is Notion-only (hidden on this Mac)', () => {
  const buttons = [...page.matchAll(/<button[^>]*>[^<]*Notion[^<]*<\/button>/g)].map(match => match[0]);
  // Since 18 Oct 2026 no Notion button is left on Profile: "View source in Notion" sits in ⋯ menus (pages/profile-menu.js, Application answers' menu), shown with Notion only.
  for (const button of buttons) assert.match(button, /data-notion-only/, button);
  assert.match(page.match(/<button[^>]*id="answers-review"[^>]*>/)[0], /data-notion-only/, 'Application answers\' ⋯ (View source in Notion) is Notion-only');
  assert.doesNotMatch(page, /<(span|b)(?![^>]*data-store-saved)[^>]*>Saved in Notion</, 'where it is saved is said by the store');
});
