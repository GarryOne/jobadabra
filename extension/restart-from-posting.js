// A broken page in the middle of an application starts it again from its job posting (owner, 16 Oct 2026: "it's just a broken page which we need to close and reopen from
// scratch"; a SuccessFactors form address had lost its site session and showed "An error occurred"). Decided by the page's own judgment, never by its words: the page-kind
// AI's "other" (no job page here) or a page the server answered with an error (ladder/site-broken.js). Only when the tab is NOT on the posting itself, and once per posting
// per tab in ten minutes, so a posting that keeps failing ends in its plain report, never a loop. Guard: desktop/test/page-steps.test.js.
import {moveTab} from './tabs.js';
import {pageKey} from './tab-pages.js';

const ONCE_MS = 10 * 60 * 1000;
const MARK = /#jobpilotto-fill(=[A-Za-z0-9_-]{1,64})?$/;

// -> true when the tab was sent back to the posting (the caller stops: the posting's own load runs the whole flow again).
export async function restartFromPosting(tab, jobUrl, {decide = () => {}, move = moveTab, store = chrome.storage.session, now = Date.now()} = {}) {
  const posting = String(jobUrl || '').split('#')[0];
  if (!/^https?:/.test(posting) || pageKey(tab.url) === pageKey(posting)) return false;   // already on the posting: nothing earlier to go back to
  const key = `restart:${tab.id}:${pageKey(posting)}`;
  const seen = (await store.get(key).catch(() => ({})))[key];
  if (seen && now - seen < ONCE_MS) return false;
  await store.set({[key]: now}).catch(() => {});
  const mark = (String(tab.url).match(MARK) || [''])[0] || '#jobpilotto-fill';   // the tab keeps its session
  let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ }
  decide('fill', 'a broken page mid-application: started again from the posting', {host});
  await move(tab.id, `${posting}${mark}`);
  return true;
}
