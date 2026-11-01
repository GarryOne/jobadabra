// What every tab of the test browser did, in order: opened, navigated (main frame), closed, plus each address the harness could not open. A failure prints the picked tab's last entries.
// Job: wait on state
// Why (a8, 1 Nov 2026, beta 41250138244, Windows apply-1of3, Edge): "the extension never finished filling … read on about:blank, 1 tab(s)" carried no evidence of WHICH navigation took the form's
// tab; the cause was a hypothesis read from code. With this list the next red names it (rule: if the red does not carry the evidence, make the failure self-explaining first).
// Invariants: addresses lose the fill mark (#jobpilotto-fill=…) and the query (no ids, no tokens in an artifact); entries are appended only, times are ms since the trail began (an injected clock in tests).
// Tests: test/harness/extension-browser.test.mjs
import fs from 'node:fs';
import path from 'node:path';

/** An address as the trail keeps it: no fill mark, no query. */
export const plain = url => String(url).replace(/#jobpilotto-fill=[^#]*/, '').replace(/\?[^#]*/, '').slice(0, 160);

/**
 * @param {{pages: () => object[], on: (name: string, fn: (page: object) => void) => void}} context  a Playwright browser context
 * @param {{now?: () => number}} [options]  now: the clock (a test passes its own)
 * @returns {{entries: object[], errors: object[], failed: Function, describe: Function, summary: Function, write: Function}}
 */
export function tabTrail(context, {now = Date.now} = {}) {
  const began = now(), entries = [], errors = [], ids = new Map();
  const add = (tab, what, address = '') => entries.push({ms: now() - began, tab, what, address: plain(address)});
  const track = page => {
    if (ids.has(page)) return;
    const tab = ids.size + 1;
    ids.set(page, tab);
    add(tab, 'open', page.url());
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) add(tab, 'navigated', frame.url()); });
    page.on('close', () => add(tab, 'closed'));
  };
  context.pages().forEach(track);
  context.on('page', track);
  const line = entry => `tab ${entry.tab} +${entry.ms} ms ${entry.what}${entry.address ? ` ${entry.address}` : ''}`;
  return {
    entries, errors,
    /** A navigation the harness started on `page` to `address` failed with `error`. */
    failed(page, address, error) {
      const message = String(error?.message || error).split('\n')[0].slice(0, 200), tab = ids.get(page) ?? 0;
      errors.push({ms: now() - began, tab, address: plain(address), message});
      add(tab, 'goto failed', `${plain(address)}: ${message}`);
    },
    /** The last `last` entries of one tab (or of all tabs when it is unknown), then every failed navigation. */
    describe(page, last = 6) {
      const tab = ids.get(page), mine = tab ? entries.filter(entry => entry.tab === tab) : entries;
      const failed = errors.map(error => `${error.address}: ${error.message}`);
      return `${tab ? `tab ${tab}` : 'no tab picked, all tabs'}: ${mine.slice(-last).map(line).join('; ') || 'no entries'}${failed.length ? `; goto errors: ${failed.join(' | ')}` : ''}`;
    },
    summary: () => entries.slice(-12).map(line).join('; '),
    /** The first `count` entries: the browser's start, the install's settings page and the first form's tab, in order. */
    head: (count = 8) => entries.slice(0, count).map(line).join('; '),
    /** The whole trail as tab-trail.json in `dir` (the run's artifacts). */
    write(dir) { fs.writeFileSync(path.join(dir, 'tab-trail.json'), JSON.stringify({entries, errors}, null, 1)); },
  };
}
