// "Find jobs using your browser" (7 Oct 2026): N at a time, each waits for its extension report, a silent one counts as stopped; the result
// message the app writes is exactly what its card reads.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {done, heardFrom, read, resultMessage, runAll, stepOf} from '../lib/visits.js';
import {parseVisits} from '../renderer/visits-card.js';

test('sites open a few at a time, each closes on its report, a silent one stops in time', async () => {
  const opened = [];
  let open = 0, most = 0;
  const openTab = url => {
    opened.push(url); open++; most = Math.max(most, open);
    const start = url.split('#')[0], ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (!start.includes('silent')) setTimeout(() => { open--; done({url: start.replace('b.example', 'b.example.ch'), ticket, jobs: start.includes('empty') ? 0 : 12, added: 3, pages: 2, stopped: start.includes('empty') ? 'the site asks you to sign in' : 'no next page'}); }, 20);
    else setTimeout(() => { open--; }, 60);
    return {ok: true};
  };
  const sites = ['a', 'b', 'empty', 'silent'].map(name => ({name, url: `https://${name}.example/jobs`}));
  const results = await runAll(sites, {atOnce: 2, openTab, waitMs: 80});
  assert.equal(most, 2, 'never more than two at once');
  assert.ok(opened.every(url => /#jp-read-filter-[a-z0-9]{8}$/.test(url)), 'each tab carries its ticket');
  assert.deepEqual(results.map(result => [result.name, result.ok, result.jobs]), [['a', true, 12], ['b', true, 12], ['empty', false, 0], ['silent', false, 0]]);
  assert.match(results[3].why, /no answer from the extension/);
});

test('Stop: the sites reading now end at once, no further one opens, and every site is in the result', async () => {
  const stop = new AbortController(), opened = [];
  const openTab = url => { opened.push(url); if (opened.length === 2) setTimeout(() => stop.abort(), 20); return {ok: true}; };   // nobody answers
  const sites = ['a', 'b', 'c', 'd'].map(name => ({name, url: `https://${name}.example/jobs`}));
  const started = Date.now();
  const results = await runAll(sites, {atOnce: 2, openTab, waitMs: 5000, quietMs: 5000, siteMs: 5000, signal: stop.signal});
  assert.ok(Date.now() - started < 1000, 'it did not wait for the open tabs');
  assert.equal(opened.length, 2, 'c and d never open');
  assert.deepEqual(results.map(result => [result.name, result.ok, result.why]), ['a', 'b', 'c', 'd'].map(name => [name, false, 'Stopped by you']));
  assert.match(resultMessage(results), /Read 0 of 4 sites/);
});

test('the result message is what the card reads, with each stopped site and its address', () => {
  const text = resultMessage([{name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/search/?keywords=photographe', ok: true, jobs: 64, added: 20},
    {name: 'Rolex', url: 'https://www.rolex.com', ok: false, why: 'the site asks you to sign in · do it, then click again', jobs: 0, added: 0}]);
  const card = parseVisits(text);
  assert.deepEqual([card.read, card.total, card.jobs, card.fresh], [1, 2, 64, 20]);
  assert.deepEqual(card.sites.map(site => [site.name, site.ok, site.url]), [['LinkedIn', true, 'https://www.linkedin.com/jobs/search/?keywords=photographe'], ['Rolex', false, 'https://www.rolex.com']]);
  assert.match(card.sites[1].detail, /sign in/);
});

test('a site that goes silent is skipped after the quiet time, in plain words, and the next one runs', async () => {
  const lines = [];
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('live')) setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 5, added: 5, pages: 1, stopped: 'no next page'}), 20);
    return {ok: true};   // 'mute' never reports: the extension's worker died
  };
  const results = await runAll([{name: 'Mute', url: 'https://mute.example'}, {name: 'Live', url: 'https://live.example'}], {atOnce: 1, openTab, quietMs: 60, waitMs: 5000, tee: line => lines.push(line)});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Mute', false], ['Live', true]]);
  assert.match(results[0].why, /stopped answering/);
  assert.ok(lines.some(line => /Mute is not responding: skipped, the next site opens/.test(line)));
});

test('a site that keeps talking but never finishes is stopped at its time budget (owner: 30-60 s a site), and the next one runs', async () => {
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('slow')) { const talk = setInterval(() => heardFrom(ticket), 10); setTimeout(() => clearInterval(talk), 400); }
    else setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 3, added: 3, pages: 1, stopped: 'no next page'}), 20);
    return {ok: true};
  };
  const results = await runAll([{name: 'Slow', url: 'https://slow.example'}, {name: 'Quick', url: 'https://quick.example'}], {atOnce: 1, openTab, quietMs: 1000, siteMs: 80, waitMs: 5000});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Slow', false], ['Quick', true]]);
  assert.match(results[0].why, /s are up: skipped, the jobs read so far are kept/);
});

test('a Find jobs using your browser run draws a row per tab at its latest state, and how far it is', async () => {
  const {siteLine} = await import('../lib/visits.js');
  const {parseSiteRows} = await import('../renderer/visits-card.js');
  const log = ['Reading 3 sites in your browser, 2 at a time', siteLine('next', 'Tag Heuer', 'https://www.tagheuer.com'), siteLine('next', 'Hublot · CH', 'https://www.hublot.com'),
    siteLine('next', 'Glassdoor', 'https://de.glassdoor.ch'), siteLine('opening', 'Tag Heuer', 'Opening in Chrome…'), siteLine('reading', 'Tag Heuer', 'page 2 · 14 jobs'),
    '⏳ Finding jobs in your browser: 0 of 3 done · 0% · now Tag Heuer', siteLine('waiting', 'Hublot · CH', 'Waiting for you in Chrome'), siteLine('done', 'Tag Heuer', '14 jobs (8 new)'),
    siteLine('stopped', 'Glassdoor', 'it stopped answering')];
  const rows = parseSiteRows(log);
  assert.deepEqual(rows.sites.map(site => [site.name, site.state]), [['Tag Heuer', 'done'], ['Hublot, CH', 'waiting'], ['Glassdoor', 'stopped']]);
  assert.equal(rows.sites[0].url, 'https://www.tagheuer.com');
  assert.deepEqual([rows.done, rows.total, rows.percent], [2, 3, 67]);
  assert.equal(parseSiteRows(['no rows here']), null);
});

test('runAll writes each site\'s states, in order, for those rows', async () => {
  const {siteLine} = await import('../lib/visits.js');
  const lines = [];
  const openTab = url => { const ticket = /-([a-z0-9]+)$/.exec(url)[1]; setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 4, added: 1, pages: 1}), 10); return {ok: true}; };
  await runAll([{name: 'A', url: 'https://a.example'}], {openTab, tee: line => lines.push(line), waitMs: 500});
  assert.deepEqual(lines.filter(line => line.includes('▸')), [siteLine('next', 'A', 'https://a.example'), siteLine('opening', 'A', 'Opening in Chrome…'), siteLine('done', 'A', '4 jobs read (1 new), 0 matching your search')]);
  assert.ok(lines.some(line => /^⏳ .*1 of 1 · 100%/.test(line)), 'the banner\'s step says the percent');
});

test('a read tab you close ends that site at once, said in its row, and the next site opens', async () => {
  const {noteTabs, siteLine} = await import('../lib/visits.js');
  const lines = [];
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('closeme')) {
      setTimeout(() => noteTabs({ids: [1, 41], boot: 'b1', reading: {[ticket]: 41}}), 10);   // Chrome reports the tab
      setTimeout(() => noteTabs({ids: [1], boot: 'b1', reading: {}}), 30);                   // ... then the person closes it
    } else setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 2, added: 2, pages: 1}), 10);
    return {ok: true};
  };
  const started = Date.now();
  const results = await runAll([{name: 'Closeme', url: 'https://closeme.example'}, {name: 'Next', url: 'https://next.example'}],
    {atOnce: 1, openTab, tee: line => lines.push(line), waitMs: 5000, quietMs: 5000, siteMs: 5000});
  assert.ok(Date.now() - started < 1000, 'no timeout waited');
  assert.deepEqual(results.map(result => [result.name, result.ok, result.why]), [['Closeme', false, 'You closed the tab'], ['Next', true, '']]);
  assert.ok(lines.includes(siteLine('closed', 'Closeme', 'You closed the tab')));
  noteTabs({ids: [], boot: 'b1', reading: {}});   // an older extension's report (no reading) changes nothing either way
  noteTabs({ids: [1], boot: 'b1'});
});

test('an extension that restarts mid-read gets its tabs handed back to read again, not skipped as silent 30 s later (owner\'s run, 7 Oct 2026 23:47)', async () => {
  const {noteTabs, siteLine} = await import('../lib/visits.js');
  const lines = [], handed = [];
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('reloaded')) {
      setTimeout(() => noteTabs({ids: [51], boot: 'r1', worker: 'w1', reading: {[ticket]: 51}}), 5);
      setTimeout(() => handed.push(noteTabs({ids: [51], boot: 'r2', worker: 'w2', reading: {}})), 15);   // reloaded: a new boot and worker
      setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 4, added: 4, pages: 1}), 40);          // ... and it read the tab again
    } else if (url.includes('woken')) {
      setTimeout(() => noteTabs({ids: [52], boot: 'r2', worker: 'w2', reading: {[ticket]: 52}}), 5);
      setTimeout(() => handed.push(noteTabs({ids: [52], boot: 'r2', worker: 'w3', reading: {}})), 15);   // Chrome stopped the worker only
      setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 2, added: 2, pages: 1}), 40);
    } else {
      setTimeout(() => noteTabs({ids: [53], boot: 'r2', worker: 'w3', reading: {[ticket]: 53}}), 5);
      setTimeout(() => handed.push(noteTabs({ids: [1], boot: 'r3', worker: 'w4', reading: {}})), 15);    // Chrome restarted: tabs renumbered
      setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 1, added: 1, pages: 1}), 40);
    }
    return {ok: true};
  };
  const results = await runAll([{name: 'Reloaded', url: 'https://reloaded.example'}, {name: 'Woken', url: 'https://woken.example'}, {name: 'Renumbered', url: 'https://renumbered.example'}],
    {atOnce: 1, openTab, tee: line => lines.push(line), waitMs: 5000, quietMs: 5000, siteMs: 5000});
  assert.deepEqual(results.map(result => result.ok), [true, true, true]);
  assert.deepEqual(handed.map(list => list.map(item => [item.tab, item.mark])), [[[51, 'jp-read-filter']], [[52, 'jp-read-filter']], []],
    'a reload and a stopped worker hand the tab back with its mark; after a Chrome restart no id is trusted');
  assert.ok(lines.includes(siteLine('reading', 'Reloaded', 'the extension restarted in Chrome: reading this tab again')));
});

test('"Open again" puts a site whose tab you closed back in the run; after the run it says to start again', async () => {
  const {again, noteTabs, siteLine} = await import('../lib/visits.js');
  const lines = [];
  let tries = 0;
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('flaky') && tries++ === 0) {
      setTimeout(() => noteTabs({ids: [7], boot: 'b2', reading: {[ticket]: 7}}), 5);
      setTimeout(() => { noteTabs({ids: [], boot: 'b2', reading: {}}); again('https://flaky.example'); }, 15);   // closed, then Open again
    } else setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 3, added: 1, pages: 1}), 30);
    return {ok: true};
  };
  const results = await runAll([{name: 'Flaky', url: 'https://flaky.example'}, {name: 'Other', url: 'https://other.example'}],
    {atOnce: 1, openTab, tee: line => lines.push(line), waitMs: 5000, quietMs: 5000, siteMs: 5000});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Flaky', true], ['Other', true]], 'the second reading is the one kept');
  assert.equal(lines.filter(line => line === siteLine('next', 'Flaky', 'https://flaky.example')).length, 2, 'its row is Next again');
  assert.ok(lines.some(line => /2 of 2 · 100%/.test(line)), 'the percent counts it once');
  assert.equal(again('https://flaky.example').ok, false);
});

test('a site read in part says why it stopped; a list read to its end says nothing more (Chanel, Van Cleef: 220 jobs at the minute, 7 Oct 2026)', () => {
  const text = resultMessage([{name: 'Van Cleef', url: 'https://careers.richemont.com/en/jobs/van-cleef-arpels', ok: true, jobs: 220, added: 220, fits: 0,
    why: '60 s are up after 11 pages: the rest of the list was not read'}, {name: 'Bulgari', url: 'https://bulgari.example', ok: true, jobs: 47, added: 47, fits: 1, why: 'no next page'}]);
  const card = parseVisits(text);
  assert.equal(card.sites[0].detail, '220 jobs (220 new), 0 matching your search; 60 s are up after 11 pages: the rest of the list was not read');
  assert.equal(card.sites[1].detail, '47 jobs (47 new), 1 matching your search');
});

test('the result says how many jobs fit the search, and the card reads it (owner: "Read 5 jobs, but my Jobs count never grows")', () => {
  const text = resultMessage([{name: 'Indeed', url: 'https://ch.indeed.com/jobs?q=photographe', ok: true, jobs: 5, added: 5, fits: 1},
    {name: 'Glassdoor', url: 'https://www.glassdoor.ch', ok: true, jobs: 3, added: 3, fits: 0}]);
  assert.match(text.split('\n')[1], /· 1 matching your search$/);
  const card = parseVisits(text);
  assert.equal(card.fits, 1);
  assert.match(card.sites[0].detail, /5 jobs \(5 new\), 1 matching your search/);
  assert.equal(parseVisits('🌐 Sites read\nRead 1 of 1 site · 4 jobs (4 new)\n✓ A · 4 jobs (4 new) · https://a.example').fits, null, 'an older result still reads');
});

test('each step a read tab takes shows live in its row, in the words of the page banner, and keeps the site from counting as silent', async t => {
  // A fake clock: the tab moves time itself (25 ms per step against a 50 ms quiet time), so a slow machine cannot turn a step into silence
  // (it failed about 1 run in 3 on real timers, 9 Oct 2026).
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: 0});
  const {stepOf, siteLine} = await import('../lib/visits.js');
  const {tellStep} = await import('../../extension/visit.js');
  const banners = [], sent = [];
  const runIn = async (tabId, func, args) => { banners.push(args[0]); };
  const send = async (config, route, {body}) => { sent.push([route, JSON.parse(body)]); stepOf(JSON.parse(body)); return {ok: true}; };
  const lines = [];
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    (async () => {
      await tellStep(5, {}, ticket, 'AI is choosing the filters for your search…', runIn, send);
      for (let i = 0; i < 6; i++) { t.mock.timers.tick(25); stepOf({ticket, words: 'AI is choosing the filters for your search…'}); }   // 150 ms: 3x the quiet time
      await tellStep(5, {}, ticket, 'reading page 1…', runIn, send);
      done({url: url.split('#')[0], ticket, jobs: 6, added: 6, pages: 1});
    })();
    return {ok: true};
  };
  const results = await runAll([{name: 'Hublot', url: 'https://www.hublot.com'}], {openTab, tee: line => lines.push(line), quietMs: 50, siteMs: 5000, waitMs: 5000});
  const seen = () => `result ${JSON.stringify(results[0])}; lines ${JSON.stringify(lines)}; banners ${JSON.stringify(banners)}`;
  assert.equal(results[0].ok, true, `not skipped as silent while Claude chose the filters: ${seen()}`);
  assert.deepEqual(banners, ['Jobadabra: AI is choosing the filters for your search…', 'Jobadabra: reading page 1…'], seen());
  assert.ok(sent.every(([route, body]) => route === '/extension/visit-state' && body.ticket && body.words));
  assert.ok(lines.includes(siteLine('reading', 'Hublot', 'AI is choosing the filters for your search…')), seen());
  await tellStep(5, {}, '', 'a tab the person opened', runIn, send);
  assert.equal(sent.length, 2, 'a tab the app did not open tells only its banner');
});

test('employers open on their job page found before the tabs open; portals and unknown sites keep their address', async () => {
  const {withJobPages} = await import('../lib/visits.js');
  let asked = null;
  const runEngine = async (_, args) => {
    asked = JSON.parse((await import('node:fs')).readFileSync(args[2], 'utf8'));
    return {code: 0, stdout: JSON.stringify({ok: true, pages: {'https://www.hublot.com': 'https://www.hublot.com/en-ch/job-offers'}})};
  };
  const lines = [];
  const sites = await withJobPages(null, [{name: 'Hublot', url: 'https://www.hublot.com', kind: 'employer'}, {name: 'Nobody', url: 'https://nobody.example', kind: 'employer'},
    {name: 'Indeed', url: 'https://ch.indeed.com/jobs', kind: 'portal'}], line => lines.push(line), runEngine);
  assert.deepEqual(asked.map(site => site.name), ['Hublot', 'Nobody'], 'portals are not looked up');
  assert.deepEqual(sites.map(site => site.url), ['https://www.hublot.com/en-ch/job-offers', 'https://nobody.example', 'https://ch.indeed.com/jobs']);
  assert.match(lines[0], /Finding the job page of 2 employers/);
});

test('a tab whose Claude is still answering is not skipped as silent, its time is not counted, and a skipped site names its last step', async () => {
  const {whileThinking, stepOf} = await import('../lib/visits.js');
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    if (url.includes('thinker')) {   // Claude answers for 150 ms: longer than the quiet time and the site's budget here
      stepOf({ticket, words: 'AI is learning how to read this site (once)…'});
      whileThinking(ticket, new Promise(resolve => setTimeout(resolve, 150))).then(() => done({url: url.split('#')[0], ticket, jobs: 2, added: 2, pages: 1}));
    } else stepOf({ticket, words: 'reading page 1…'});   // then nothing: skipped, with its last step named
    return {ok: true};
  };
  const results = await runAll([{name: 'Thinker', url: 'https://thinker.example'}, {name: 'Mute', url: 'https://mute.example'}],
    {atOnce: 1, openTab, quietMs: 40, siteMs: 60, waitMs: 5000});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Thinker', true], ['Mute', false]]);
  assert.match(results[1].why, /\(last step: reading page 1\)/);
});

test('each site finds its job page in its own lane, just before its tab opens: the first tab does not wait for every lookup', async () => {
  const opened = [];
  const openTab = url => {
    opened.push([url.split('#')[0], Date.now()]);
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 1, added: 1, pages: 1}), 5);
    return {ok: true};
  };
  const prepare = site => new Promise(resolve => setTimeout(() => resolve({...site, url: `${site.url}/careers`}), site.name === 'Slow' ? 200 : 10));
  const started = Date.now();
  const results = await runAll([{name: 'Quick', url: 'https://quick.example'}, {name: 'Slow', url: 'https://slow.example'}], {atOnce: 2, openTab, prepare, waitMs: 5000});
  assert.ok(opened.find(([url]) => url === 'https://quick.example/careers')[1] - started < 150, 'Quick opened before Slow\'s lookup ended');
  assert.deepEqual(results.map(result => [result.name, result.url, result.start]), [['Quick', 'https://quick.example/careers', 'https://quick.example'], ['Slow', 'https://slow.example/careers', 'https://slow.example']]);
});

test('a Read with Claude session\'s result is read under its session name', async () => {
  const {claudeResult} = await import('../lib/visits.js');
  let asked = null;
  const result = await claudeResult(null, 'ab12cd34', async (_, args) => { asked = args; return {code: 0, stdout: 'Visit: …\n{"ok": true, "result": {"name": "IWC", "jobs": 4, "fits": 1}}'}; });
  assert.deepEqual(asked, ['src.desktop', 'visit-session', 'read_ab12cd34.json']);
  assert.deepEqual([result.jobs, result.fits], [4, 1]);
});

test('a scout\'s plain-http address is opened as https, not refused as "no address" (Tag Heuer, Hublot, 7 Oct 2026)', async () => {
  const {open} = await import('../lib/visits.js');
  const opened = open('http://www.hublot.com/joboffers/en', () => ({unref() {}}));
  assert.notEqual(opened.error, 'This site has no address to open.');
  assert.equal(open('ftp://x.example').error, 'This site has no address to open.');
});

test('Open in Chrome finds a site\'s tab by the id the extension reported, wherever the tab moved', async () => {
  const {noteTabs, showTab} = await import('../lib/visits.js');
  const asked = [];
  let shown;
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    setTimeout(() => noteTabs({ids: [1044091821], boot: 'b9', reading: {[ticket]: 1044091821}}), 5);   // the tab, now on careers.richemont.com
    setTimeout(async () => {
      shown = await showTab('https://www.rogerdubuis.com', {focusById: async id => { asked.push(['id', id]); return true; },
        focusAt: async page => { asked.push(['address', page]); return false; }, bringForward: () => asked.push(['browser'])});
      done({url: url.split('#')[0], ticket, jobs: 1, added: 1, pages: 1});
    }, 20);
    return {ok: true};
  };
  await runAll([{name: 'Roger Dubuis', url: 'https://www.rogerdubuis.com'}], {openTab, waitMs: 2000, quietMs: 2000, siteMs: 2000});
  assert.deepEqual(asked, [['id', 1044091821]], 'by its id, not by the address it started at');
  assert.equal(shown.found, true);
});

test('a page whose saving asks Claude (slower than the quiet time) does not get its site skipped as silent', async () => {
  const {read} = await import('../lib/visits.js');
  const slowSave = () => new Promise(resolve => setTimeout(() => resolve({code: 0, stdout: '{"ok": true, "name": "Hublot", "jobs": 3, "added": 3, "fits": 0}'}), 150));
  const openTab = url => {
    const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    read(null, {url: url.split('#')[0], ticket, html: '<html></html>', cards: []}, slowSave).then(() => done({url: url.split('#')[0], ticket, jobs: 3, added: 3, pages: 1}));
    return {ok: true};
  };
  const results = await runAll([{name: 'Hublot', url: 'https://www.hublot.example'}], {atOnce: 1, openTab, quietMs: 40, siteMs: 5000, waitMs: 5000});
  assert.deepEqual(results.map(result => [result.name, result.ok]), [['Hublot', true]]);
});

test("Jobs we couldn't read: each posting opens with its ticket, its text is saved for the job, a login wall and silence are said", async () => {
  const {posting, readPostings} = await import('../lib/visits.js');
  const saves = [];
  const runEngine = async (_storage, args) => {   // the engine's set-description: the file it was given, answered as saved
    const fs = await import('node:fs');
    saves.push(JSON.parse(fs.readFileSync(args[2], 'utf8')));
    return {stdout: JSON.stringify({ok: true, saved: true})};
  };
  const opened = [];
  const openTab = url => {
    opened.push(url);
    const ticket = /#jp-posting-([a-z0-9]{8})$/.exec(url)[1], start = url.split('#')[0];
    if (start.includes('indeed')) setTimeout(() => posting({}, {ticket, url: start, text: 'You advise our clients. '.repeat(20), blocked: ''}, runEngine), 10);
    if (start.includes('linkedin')) setTimeout(() => posting({}, {ticket, url: start, text: 'Sign in', blocked: 'login'}, runEngine), 10);
    return {ok: true};
  };
  const lines = [];
  const jobs = [{url: 'https://ch.indeed.com/viewjob?jk=1', title: 'Vendeur'}, {url: 'https://www.linkedin.com/jobs/view/2', title: 'Sales'}, {url: 'https://quiet.example/job/3', title: 'Advisor'}];
  const saved = await readPostings(jobs, {openTab, waitMs: 60, tee: line => lines.push(line)});
  assert.equal(saved, 1);
  assert.equal(opened.length, 3, 'one at a time, each opened');
  assert.deepEqual(saves.map(save => save.url), ['https://ch.indeed.com/viewjob?jk=1'], 'only a posting with its text is saved; a login wall is not');
  assert.ok(lines.some(line => /✗ Sales: needs you to sign in/.test(line)) && lines.some(line => /✗ Advisor: no answer from the extension/.test(line)));
  const card = parseVisits(resultMessage([], {added: 1, postings: {asked: 3, read: saved}}));
  assert.deepEqual(card.postings, {asked: 3, read: 1}, 'the result card reads what the run wrote');
});

test('opening a site you have open brings its tab forward, by the page last read there; else it opens a new tab (owner, 8 Oct 2026)', async () => {
  const {openYourself} = await import('../lib/visits.js');
  const asked = [], opened = [];
  const opener = url => { opened.push(url); return {ok: true}; };
  const found = await openYourself('https://www.hublot.com', {focusById: async () => false, focusAt: async page => { asked.push(page); return page === 'https://www.hublot.com'; }, opener});
  assert.deepEqual([found.focused, opened], [true, []], 'its tab, not a new one');
  const none = await openYourself('https://www.omega.example', {focusById: async () => false, focusAt: async () => false, opener});
  assert.deepEqual([none.ok, opened], [true, ['https://www.omega.example']], 'no tab: a new one');
});

test('Open on a "Browse sites manually" card starts the tracked read; a site it cannot take opens plain', async () => {
  const {readSiteInChrome} = await import('../renderer/coverage-actions.js');
  const calls = [];
  const pilot = answer => ({visitsRun: async arg => { calls.push(['run', arg.urls]); return answer; }, openVisit: async url => { calls.push(['open', url]); return {ok: true}; }});
  const started = await readSiteInChrome(pilot({started: true}), 'https://www.msc.example/careers');
  const refused = await readSiteInChrome(pilot({text: 'Tick at least one site or job to read.'}), 'https://www.msc.example/careers');
  assert.deepEqual(calls, [['run', ['https://www.msc.example/careers']], ['run', ['https://www.msc.example/careers']], ['open', 'https://www.msc.example/careers']]);
  assert.deepEqual([started.started, refused.started, refused.ok, refused.why], [true, false, true, 'Tick at least one site or job to read.']);
  const {readFileSync} = await import('node:fs');   // the class: no manual-browse opener calls the bare openVisit
  for (const file of ['../renderer/pages/strategy-suggestions.js', '../renderer/coverage-actions.js']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(/readSiteInChrome/.test(text) && !/pilot\.openVisit\((chip\.url|action\.value)\)/.test(text), file);
  }
});

test('a site whose list has none in your places today counts as read, not failed (owner, 8 Oct 2026: Jaeger-LeCoultre was a red ✗)', async () => {
  const openTab = url => { const ticket = /-([a-z0-9]+)$/.exec(url)[1];
    setTimeout(() => done({url: url.split('#')[0], ticket, jobs: 0, added: 0, pages: 1, empty: true, stopped: 'its job list has no jobs here today (filtered to your places)'}), 5);
    return {ok: true}; };
  const [result] = await runAll([{name: 'Maison', url: 'https://careers.maison.example'}], {atOnce: 1, openTab, waitMs: 5000, quietMs: 5000, siteMs: 5000});
  assert.equal(result.ok, true);
  assert.match(resultMessage([result]), /^🌐 Sites read\nRead 1 of 1 site/);
});

// #1067: a held board's 30-minute wait (BOARD_WAIT_MS) kept running after the person pressed Read and cut the read off at 30 minutes from the opening.
test('a held board whose Read was pressed is not cut off by the wait for the person', async () => {
  let ticket = '';
  const openTab = url => {
    ticket = /-([a-z0-9]+)$/.exec(url)[1];
    setTimeout(() => stepOf({ticket, words: 'Reading page 1'}), 40);   // the person pressed Read
    setTimeout(() => done({url: 'https://board.example/jobs', ticket, jobs: 7, added: 2, pages: 1, stopped: 'no next page'}), 200);   // later than the wait
    return {ok: true};
  };
  const [result] = await runAll([{name: 'board', url: 'https://board.example/jobs', kind: 'board'}], {hold: true, atOnce: 1, openTab, waitMs: 120, quietMs: 5000, siteMs: 5000});
  assert.equal(result.ok, true, result.why);
  assert.equal(result.jobs, 7);
});

test('a read that met a sign-in or a check keeps which one, from the page kind the extension judged (not from its words)', async () => {
  const openTab = url => {
    const start = url.split('#')[0], ticket = /-([a-z0-9]+)$/.exec(url)[1];
    const blocked = start.includes('login') ? 'login' : start.includes('check') ? 'check' : '';
    setTimeout(() => done({url: start, ticket, jobs: 0, added: 0, pages: 0, ...(blocked ? {blocked, stopped: 'words that say anything'} : {stopped: '2 pages read'})}), 5);
    return {ok: true};
  };
  const sites = ['login', 'check', 'plain'].map(name => ({name, url: `https://${name}.example/jobs`}));
  const results = await runAll(sites, {atOnce: 3, openTab, waitMs: 500});
  assert.deepEqual(results.map(result => [result.name, result.blocked]), [['login', 'login'], ['check', 'check'], ['plain', '']]);
});

test('maxPages: the read ends after that many pages, keeps the jobs read, and says why (the extension reads up to 20 otherwise)', async () => {
  let pagesSent = 0;
  const engine = async () => ({code: 0, stdout: JSON.stringify({ok: true, jobs: 25 * pagesSent, added: 3 * pagesSent, fits: 2})});
  const openTab = url => {
    const start = url.split('#')[0], ticket = /-([a-z0-9]+)$/.exec(url)[1];
    (async () => { for (let page = 1; page <= 6; page++) { pagesSent = page; await read({}, {url: `${start}&start=${page * 25}`, ticket, cards: [], session: 's'}, engine); } })();
    return {ok: true};
  };
  const [result] = await runAll([{name: 'Capped', url: 'https://capped.example/jobs?q=x'}], {openTab, filter: false, maxPages: 3, waitMs: 500});
  assert.equal(result.ok, true);
  assert.equal(result.jobs, 75, 'the jobs of the three pages read are kept');
  assert.match(result.why, /^3 pages read: the most for this read/);
  const [open] = await runAll([{name: 'Open', url: 'https://open.example/jobs?q=x'}], {openTab: url => { const ticket = /-([a-z0-9]+)$/.exec(url)[1]; setTimeout(() => done({url, ticket, jobs: 9, added: 1, pages: 6, stopped: 'no next page'}), 5); return {ok: true}; }, waitMs: 500});
  assert.equal(open.why, 'no next page', 'without maxPages nothing is cut');
});
