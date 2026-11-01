// A tab the app opened to apply, on a site the extension may not run on yet (extension/site-allow.js). 9 Oct 2026: on a friend's
// Windows Chrome, jobs.ch got a '?' badge and nothing else: no panel, no Allow, no line in the app's log.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fillWaitsForAllow, resumeFillWaiting, watchUnallowedFillTabs} from '../../extension/site-allow.js';

function fakeChrome({allowed = false} = {}) {
  const session = {}, calls = [], open = new Set();
  const chrome = {
    calls, session,
    storage: {session: {
      get: async key => (key === null ? {...session} : {[key]: session[key]}),
      set: async values => { Object.assign(session, values); },
      remove: async key => { delete session[key]; },
    }},
    action: {setBadgeText: async args => calls.push(['badge', args.text]), setTitle: async args => calls.push(['title', args.title])},
    tabs: {
      get: async id => (open.has(id) ? {id} : null),
      create: async ({url}) => { calls.push(['created', 77, url]); open.add(77); return {id: 77}; },
      reload: async id => calls.push(['reload', id]),
    },
    runtime: {getURL: path => `chrome-extension://x/${path}`},
    permissions: {contains: async () => allowed},
  };
  return chrome;
}

test('an apply tab on a site not allowed waits visibly, opens Allow once, and says so in the app log', async () => {
  const chrome = fakeChrome();
  const said = [];
  const decide = async (kind, text, fields) => said.push({kind, text, fields});
  const url = 'https://www.jobs.ch/en/vacancies/detail/a601bb40/#jobpilotto-fill';
  await fillWaitsForAllow(12, url, {chrome, decide});
  await fillWaitsForAllow(12, url, {chrome, decide});   // the same page loading again
  await fillWaitsForAllow(13, 'https://www.jobup.ch/x#jobpilotto-fill', {chrome, decide});
  assert.ok(chrome.calls.some(([kind, text]) => kind === 'badge' && text === '!'), 'the tab is badged: waiting for you');
  assert.ok(chrome.calls.some(([kind, title]) => kind === 'title' && /press Allow/.test(title)));
  assert.equal(chrome.calls.filter(([kind]) => kind === 'created').length, 1, 'one Allow page for every waiting tab');
  assert.equal(chrome.calls.find(([kind]) => kind === 'created')[2], 'chrome-extension://x/allow.html');
  assert.deepEqual(said.map(entry => entry.fields.host), ['www.jobs.ch', 'www.jobup.ch'], 'one log line per tab and page, host only');
  assert.match(said[0].text, /waits for Allow/);
});

test('Allow pressed: every waiting apply tab loads again and starts', async () => {
  const chrome = fakeChrome({allowed: true});
  chrome.session['fillwait:12'] = 'https://www.jobs.ch/x#jobpilotto-fill';
  chrome.session['fillwait:13'] = 'https://www.jobup.ch/x#jobpilotto-fill';
  chrome.session['waiting:20'] = 'a reading tab: visit.js resumes it, not this';
  const said = [];
  assert.equal(await resumeFillWaiting({chrome, decide: async (kind, text, fields) => said.push(fields)}), 2);
  assert.deepEqual(chrome.calls.filter(([kind]) => kind === 'reload').map(([, id]) => id).sort(), [12, 13]);
  assert.equal(chrome.session['fillwait:12'], undefined);
  assert.ok(chrome.session['waiting:20']);
  assert.deepEqual(said, [{tabs: 2}]);
});

test('a permission added for something else starts nothing', async () => {
  const chrome = fakeChrome({allowed: false});
  chrome.session['fillwait:12'] = 'https://www.jobs.ch/x#jobpilotto-fill';
  assert.equal(await resumeFillWaiting({chrome}), 0);
  assert.ok(chrome.session['fillwait:12']);
});

test('the tab is seen through webNavigation, which has the address on a site tabs.onUpdated cannot read', async () => {
  const chrome = fakeChrome();
  const listeners = [];
  chrome.webNavigation = {onCompleted: {addListener: f => listeners.push(['completed', f])}, onReferenceFragmentUpdated: {addListener: f => listeners.push(['fragment', f])}};
  const allowedHosts = new Set(['https://jobs.lever.co/*']);
  chrome.permissions.contains = async ({origins}) => allowedHosts.has(origins[0]);
  const said = [];
  const check = watchUnallowedFillTabs({chrome, decide: async (kind, text, fields) => said.push(fields.host)});
  assert.deepEqual(listeners.map(([name]) => name), ['completed', 'fragment'], 'a page load and a mark added to an open tab');
  await check({frameId: 0, tabId: 5, url: 'https://www.jobs.ch/x/#jobpilotto-fill'});
  await check({frameId: 1, tabId: 5, url: 'https://ads.example/#jobpilotto-fill'});   // a frame inside the page
  await check({frameId: 0, tabId: 6, url: 'https://www.jobs.ch/x/'});                 // no mark: a tab the person opened
  await check({frameId: 0, tabId: 7, url: 'https://jobs.lever.co/x#jobpilotto-fill'}); // allowed: background.js fills it
  assert.deepEqual(said, ['www.jobs.ch']);
  assert.ok(chrome.session['fillwait:5'] && !chrome.session['fillwait:7']);
});

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
test('the apply path and the read path share the one Allow page, and the popup never claims a fill that cannot start', () => {
  assert.match(read('extension/background.js'), /if \(info\.status === 'complete'\) await fillWaitsForAllow\(tabId, tab\.url, \{decide\}\)/);
  assert.match(read('extension/background.js'), /permissions\.onAdded\.addListener\(\(\) => \{ startWaiting\(\); resumeFillWaiting\(\{decide\}\); \}\);\n  watchUnallowedFillTabs\(\{decide\}\);/);
  assert.doesNotMatch(read('extension/background.js'), /setBadgeText\(\{tabId, text: '\?'\}\)/, 'no silent ? badge');
  assert.match(read('extension/visit.js'), /await openAllowPage\(\)/);
  assert.match(read('extension/popup.js'), /isn\\'t allowed on this site yet/);
});
