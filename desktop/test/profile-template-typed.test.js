// A new install starts in the typed shape (owner, 18 Oct 2026: "Drop them" / "Move both"; plan PR 9, M15): the template the setup draft writes the Profile
// and the Application answers from (docs/notion-profile-template.md) has Your details' three sections, each fact in one place across both pages, no
// "Links" or 📇 section of its own (the app writes 📇 from the CV), Hard constraints with search filters only, an answers page without the facts' tables;
// and every Goal still finds its own line in it. Read on both stores, the sections come back with their labels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as sections from '../lib/profile-sections.js';
import {TEXT_FILES} from '../lib/store/text-files.js';
import {GOAL_ROWS, applyGoal} from '../renderer/markdown-edit.js';
import {fakeNotion} from './fake-notion.js';

const TEMPLATE = fs.readFileSync(new URL('../../docs/notion-profile-template.md', import.meta.url), 'utf8');
const PROFILE = TEMPLATE.split('## 👤 Profile — CV and Preferences')[1].split('\n---')[0];
const ANSWERS = TEMPLATE.split('## 📝 Application Answers — Standard Form Fields')[1].split('\n## Where the CV file')[0];
const bare = text => String(text).replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
const headings = text => [...text.matchAll(/^#{1,3} (.+)$/gm)].map(match => match[1].trim());
// A fact's label: a table row's first cell or a "Label: value" line's label, without marks.
const labels = text => text.split('\n').flatMap(line => {
  const row = line.match(/^\|\s*([^|]+?)\s*\|/);
  if (row && !/^-+$/.test(row[1]) && !/^(constraint|preference|question|field|school)$/i.test(row[1])) return [row[1]];
  const item = line.match(/^- ([^:]{2,80}):/);
  return item ? [item[1]] : [];
}).map(label => label.replace(/\*\*/g, '').trim().toLowerCase());

test('the Profile template has Your details\' three sections, each with its fact lines to fill', () => {
  for (const title of Object.values(sections.SECTIONS)) {
    const at = PROFILE.indexOf(`## ${title}`);
    assert.ok(at >= 0, `${title}: missing`);
    const body = PROFILE.slice(at).split('\n').slice(1).join('\n').split(/\n#{1,3} /)[0];
    assert.match(body, /^- [^:]+: ❓/m, `${title}: no line to fill`);
  }
});

test('each fact has one place across the Profile and the Application answers', () => {
  const all = [...labels(PROFILE), ...labels(ANSWERS)];
  const twice = all.filter((label, i) => all.indexOf(label) !== i);
  assert.deepEqual(twice, [], 'a fact in two places');
});

test('no Links or Contact section in the template (the app writes 📇 from the CV); Hard constraints holds search filters only', () => {
  assert.deepEqual(headings(PROFILE).filter(heading => /^(links|contact|📇)/i.test(bare(heading)) || /contact details/i.test(heading)), []);
  const hard = PROFILE.split('# Hard constraints')[1].split('\n# ')[0];
  assert.doesNotMatch(hard, /work permit|languages i can work in/i);
  assert.doesNotMatch(PROFILE.split('# Preferences')[1].split('\n# ')[0], /start date|notice/i);
});

test('the Application answers template keeps only what is not a fact: Common questions and Cover letter style', () => {
  assert.deepEqual(headings(ANSWERS), ['Common questions', 'Cover letter style']);
});

test('every Goal finds its own line in the template (no "Confirmed during setup" fallback)', () => {
  for (const key of Object.keys(GOAL_ROWS)) {
    const written = applyGoal(PROFILE, key, 'Written by the test');
    assert.doesNotMatch(written, /# Confirmed during setup/, `${key}: not found in the template`);
    assert.match(written, /Written by the test/, key);
  }
});

const fresh = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-template-')), {encrypt: v => v, decrypt: v => v});
const DETAILS = PROFILE.slice(PROFILE.indexOf(`## ${sections.SECTIONS.eligibility}`)).split('\n').filter(line => line.trim());
for (const [name, open] of Object.entries({
  sqlite: () => { const storage = fresh(); storage.saveSettings({store: 'sqlite', telemetry: false}); storage.writeText(TEXT_FILES.profile, PROFILE); return {storage}; },
  notion: () => {
    const storage = fresh();
    storage.setSecret('NOTION_TOKEN', 'ntn_x');
    storage.saveSettings({setupDone: true, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
    return {storage, fetcher: fakeNotion(DETAILS.map(line => line.replace(/^- /, ''))).fetcher};
  },
})) {
  test(`${name}: the template's Your details sections read back with their labels`, async () => {
    const {storage, fetcher} = open();
    const read = await sections.read(storage, fetcher);
    for (const key of Object.keys(sections.SECTIONS)) assert.ok(read[key].length > 0, `${key}: no line read`);
    assert.ok(read.languages.some(line => /languages i can work in/i.test(line.label)));
  });
}

// Why (28 Oct 2026, owner, #2322: "Questions name a country, never a city"): Work eligibility is Nationality plus the three zones, each a row the app reads,
// and the setup draft is told so; no line asks about a home region, a city or a single "work permit".
test('Work eligibility in the template and the setup prompt: Nationality and the zones, never a city', async () => {
  const {INSTRUCTIONS} = await import('../lib/strategy.js');
  const eligibility = PROFILE.split('## 🛂 Work eligibility')[1].split('\n## ')[0];
  const lines = eligibility.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).split(':')[0]);
  assert.deepEqual(lines, ['Nationality', 'EU / EEA + Switzerland', 'United Kingdom', 'United States', 'Remote from your country for a foreign employer?']);
  for (const zone of lines.slice(1, 4)) assert.match(eligibility, new RegExp(`- ${zone.replace(/[+/]/g, '\\$&')}: .*\\[per country\\]`), zone);
  assert.doesNotMatch(eligibility, /\[your home|Work permit \/ visa|city/i);
  assert.match(INSTRUCTIONS, /Nationality is the countries of citizenship/);
  assert.match(INSTRUCTIONS, /never a line about a city/);
});
