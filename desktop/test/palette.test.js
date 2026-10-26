import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rank, shownLabel} from '../renderer/palette.js';
import {osText} from '../renderer/os.js';

const commands = [
  {label: 'Open Jobs', keywords: 'page view'},
  {label: 'Search now', hint: 'Look for new jobs', keywords: 'search jobs find refresh'},
  {label: 'Check Gmail', hint: 'Confirmations, replies, interviews (if connected)', keywords: 'email inbox replies'},
  {label: 'Open Settings', keywords: 'page view'},
  {label: 'Record interview', keywords: 'start call audio'},
];
const labels = list => list.map(command => command.label);

test('the palette finds a command by the words you type, filler words ignored', () => {
  assert.equal(rank(commands, 'Check for gmail')[0].label, 'Check Gmail');
  assert.equal(rank(commands, 'gmail')[0].label, 'Check Gmail');
  assert.equal(rank(commands, 'email')[0].label, 'Check Gmail');     // a keyword
  assert.equal(rank(commands, 'sett')[0].label, 'Open Settings');    // a word's start
  assert.equal(rank(commands, 'record')[0].label, 'Record interview');
  assert.deepEqual(labels(rank(commands, 'gmail calendar zebra')), []);  // every meaningful word must match
});

test('the label counts more than keywords, and an empty query lists everything in order', () => {
  assert.deepEqual(labels(rank(commands, 'jobs')), ['Open Jobs']);   // "Search now" holds jobs only in its keywords: it goes beside a label match
  assert.deepEqual(labels(rank(commands, 'find')), ['Search now']);   // and stays when nothing else matches
  assert.deepEqual(labels(rank(commands, '')), labels(commands));
  assert.deepEqual(labels(rank(commands, 'the')), []);  // only filler: taken literally
});

test('Windows reads Ctrl+K', () => {
  assert.equal(osText('⌘K  Commands', 'win32'), 'Ctrl+K  Commands');
});

// One row per card (owner, 27 Oct 2026: "when searching for Extension, I see too many options. I'd expect to see Settings -> Connections -> Chrome extension
// and that's pretty much it"). A card's parts fold under it; a hint-only match goes when the label of another row matches; same path, one row.
const card = {group: 'Settings', label: 'Chrome extension', keywords: 'settings connections', path: ['Settings', 'Connections', 'Chrome extension']};
const dev = {group: 'Settings', label: 'Developer options', path: ['Settings', 'General', 'Developer options']};
const shape = [
  {group: 'Sessions', label: 'Stop the extension', hint: 'Stops everything the extension does', keywords: 'stop extension chrome', kind: 'part'},
  {group: 'Settings', label: 'Chrome extension: Manage', kind: 'part', parent: card, path: [...card.path, 'Manage']},
  card,
  {group: 'Settings', label: 'Chrome extension: chrome://extensions', kind: 'part', parent: card, path: [...card.path, 'chrome://extensions']},
  dev,
  {group: 'Settings', label: 'Chrome extension: manual connection', hint: 'Section · Developer options', kind: 'part', parent: dev, path: [...dev.path, 'Chrome extension: manual connection']},
  {group: 'Actions', label: 'Find jobs using your browser', hint: 'Read in your browser by the extension'},
  {group: 'Reports', label: 'Open Reports: Form fills', keywords: 'extension fills forms'},
  {group: 'Settings', label: 'Your data', path: ['Settings', 'General', 'Your data']},
  {group: 'Settings', label: 'Your data: Export data', kind: 'part', parent: {label: 'Your data'}, path: ['Settings', 'General', 'Your data', 'Export data']},
  {group: 'Jobs', label: 'Export job list'},
  {group: 'Settings', label: 'Plan', path: ['Settings', 'Plan']},
  {group: 'Settings', label: 'Open Settings: Plan', path: ['Settings', 'Plan']},
];
const shown = (list, query) => rank(list, query).map(shownLabel);

test('a card is one row with its path; its parts fold under it', () => {
  assert.deepEqual(shown(shape, 'extension'), ['Settings → Connections → Chrome extension']);
  assert.deepEqual(shown(shape, 'chrome'), ['Settings → Connections → Chrome extension']);
});

test('a part shows, with its path, when the query names the part itself', () => {
  assert.deepEqual(shown(shape, 'stop extension'), ['Stop the extension']);
  assert.deepEqual(shown(shape, 'manual connection'), ['Settings → General → Developer options → Chrome extension: manual connection']);
  assert.ok(shown(shape, 'chrome://').includes('Settings → Connections → Chrome extension → chrome://extensions'));
  assert.ok(shown(shape, 'export').includes('Settings → General → Your data → Export data'), 'a part found by its own words stays beside another card');
});

test('a hint-only match goes beside a label match, and stays when nothing better matches', () => {
  assert.ok(!shown(shape, 'extension').includes('Find jobs using your browser'));
  assert.deepEqual(shown(shape, 'fills'), ['Open Reports: Form fills']);
  assert.equal(rank(commands, 'email')[0].label, 'Check Gmail');
});

test('the same path is one row', () => {
  assert.deepEqual(shown(shape, 'plan'), ['Settings → Plan']);
});

test('a card\'s own words count as its name; a card named whole folds every part', () => {
  const list = [
    {group: 'Settings', label: 'Notifications', alias: 'email telegram', keywords: 'settings automation', path: ['Settings', 'Automation', 'Notifications']},
    {group: 'Settings', label: 'Always on: Save email', kind: 'part', parent: {label: 'Always on'}},
    {group: 'Settings', label: 'Notion', path: ['Settings', 'Connections', 'Notion']},
    {group: 'Notion', label: 'Notion: Job matches', kind: 'part'},
    {group: 'Settings', label: 'Your data: Open in Notion', kind: 'part', parent: {label: 'Your data'}},
  ];
  assert.deepEqual(shown(list, 'email'), ['Settings → Automation → Notifications', 'Always on: Save email']);
  assert.deepEqual(shown(list, 'notion'), ['Settings → Connections → Notion']);
  assert.deepEqual(shown(list, 'notion job matches'), ['Notion: Job matches']);
});
