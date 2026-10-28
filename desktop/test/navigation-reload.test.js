// Real Profile tab and answer-filter transitions survive data loads and a renderer's session memory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
const body = install();
const {window, document} = globalThis;
const memory = new Map();
globalThis.sessionStorage = {getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value))};
window.pilot = new Proxy({state: async () => ({settings: {}}), contact: async () => { throw new Error('Fictional offline contact unavailable'); }, textOutline: async () => ({ok: true, items: [], store: 'sqlite'})}, {get: (all, key) => all[key] || (() => null)});
const backdrop = document.createElement('div'); backdrop.id = 'job-drawer-backdrop'; body.append(backdrop);
const interval = globalThis.setInterval;
globalThis.setInterval = (...args) => interval(...args).unref();
const {profileTab} = await import('../renderer/pages/profile.js');
const {settingsPage} = await import('../renderer/pages/settings.js');
const {loadApplicationAnswers} = await import('../renderer/pages/application-answers.js');
globalThis.setInterval = interval;
const node = (tag, dataset, id) => { const item = document.createElement(tag); Object.assign(item.dataset, dataset); if (id) item.id = id; body.append(item); return item; };
const tabs = ['cv', 'details', 'experience', 'answers', 'letter'].map(name => node('button', {profileTab: name}));
node('div', {}, 'answers-body');
for (const id of ['claude-auto-line', 'claude-auto', 'contact-cv', 'contact-panel-message']) node('div', {}, id);

test('Profile → What we learned → New stays selected on a data refresh and reopening Profile', async () => {
  profileTab('answers');
  await loadApplicationAnswers();
  document.querySelectorAll('#answers-body .segmented button').find(button => button.dataset.view === 'new').click();
  await loadApplicationAnswers();
  assert.equal(document.querySelector('#answers-body .segmented .is-active')?.dataset.view, 'new', 'data refresh preserves New');
  settingsPage('profile');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tabs.find(tab => tab.classList.contains('is-active'))?.dataset.profileTab, 'answers', 'async Profile initialization preserves the tab');
  assert.equal(memory.get('profileTab'), 'answers');
  assert.equal(memory.get('answersView'), 'new');
});

test('a new renderer restores Profile and another page; absent, stale and malformed destinations fall back safely', async () => {
  const {restoreView, remembered} = await import('../renderer/view-memory.js');
  for (const name of ['settings', 'jobs', 'focus']) node('div', {view: name}).className = 'view';
  node('div', {settingsPage: 'profile'});
  const visits = [];
  const restore = () => restoreView({document, fallback: 'jobs', openView: name => { visits.push(name); remembered('view', name); remembered('settingsPage', 'overview'); }, settingsPage: name => visits.push(name)});
  remembered('view', 'settings'); remembered('settingsPage', 'profile'); restore();
  assert.deepEqual(visits.splice(0), ['settings', 'profile'], 'snapshot section before openView resets it');
  for (const name of ['jobs', 'focus']) { remembered('view', name); restore(); assert.deepEqual(visits.splice(0), [name]); }
  for (const value of [null, 'removed-page', '"]invalid[']) {
    memory.clear(); if (value !== null) remembered('view', value); restore();
    assert.deepEqual(visits.splice(0), ['jobs']);
  }
  const storage = globalThis.sessionStorage;
  globalThis.sessionStorage = {getItem() { throw new Error('Unavailable'); }, setItem() { throw new Error('Unavailable'); }};
  try { restore(); assert.deepEqual(visits.splice(0), ['jobs']); remembered('profileTab', 'answers'); }
  finally { globalThis.sessionStorage = storage; }
});
