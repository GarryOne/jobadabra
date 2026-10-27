// A redirect that dropped the posting address's query string is undone once: the same page is opened again with the posting's own query (owner, 27 Oct 2026: the fair round's
// gap to Browser Use; form 264402, an employer page embedding a job board: http -> https lost "?gh_jid=<job>", the embed showed the whole list instead of the job, and the flow read
// the list's search boxes). Structure only: addresses compared, never a page word or a site name. Once per tab and posting, so a site that strips it again ends in the page as it is.
// Guard: desktop/test/restore-query.test.js.
import {moveTab} from './tabs.js';
import {pageKey} from './tab-pages.js';
import {requestedOf} from './requested-url.js';

const parse = url => { try { const parsed = new URL(String(url || '')); return /^https?:$/.test(parsed.protocol) ? parsed : null; } catch { return null; } };
const samePage = (a, b) => a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '');

// -> the tab's own address with the posting's query added (its #mark kept), or '' when the tab is not the posting's page, or has a query of its own, or the posting had none.
export function restoredQueryUrl(tabUrl, postingUrl) {
  const at = parse(tabUrl), posting = parse(postingUrl);
  if (!at || !posting || !posting.search || at.search || !samePage(at, posting)) return '';
  at.search = posting.search;
  return at.href;
}

// -> true when the tab was sent to the restored address (the caller stops: that page's own load runs the whole flow).
export async function restoreLostQuery(tab, jobUrl, {decide = () => {}, move = moveTab, store = chrome.storage.session} = {}) {
  const asked = await requestedOf(tab.id, store);   // the address the app opened the tab with, before any redirect; the job's own address when the tab's first look already had it
  const posting = asked || String(jobUrl || '').split('#')[0];
  const url = restoredQueryUrl(tab.url, posting);
  if (!url) return false;
  const key = `restore-query:${tab.id}:${pageKey(posting)}`;
  if ((await store.get(key).catch(() => ({})))[key]) return false;
  await store.set({[key]: Date.now()}).catch(() => {});
  decide('fill', 'a redirect dropped the posting\'s query: opened the page again with it', {host: parse(url).hostname});
  await move(tab.id, url);
  return true;
}
