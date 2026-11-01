// The site-password answer of the offline app (no Electron): the same decision modules the app's handler uses (lib/ext-server-handlers.js: credentials.forExtension, modeOf),
// WITHOUT its pipeline, so it only ever hands over an item that already exists (a seeded test account, lib/test-accounts.mjs); it never makes a password or an account.
// Before this the offline server answered {ok:false} to every sign-in page, so the seeded test account was never used (Richemont Workday, 16 Oct 2026).
// Guard: e2e/test/replay/offline-site-password.test.mjs.
import * as credentials from '../../lib/credentials.js';
import {automationOf, modeOf} from '../../lib/site-accounts.js';

// -> the handler for server-hooks setSitePasswordHandler. storage: the offline app's own storage (its settings).
export function offlineSitePassword(storage, {read = host => credentials.forExtension(host, {applying: true}), emailOf = host => credentials.emailOf(host), email: contactEmail = async () => ({})} = {}) {   // email: () => the applicant's contact; the child passes lib/contact.js's read (a leaf-only module here: installed-only.test.mjs)
  return async ({host, peek} = {}) => {
    const email = await Promise.resolve(contactEmail()).then(contact => contact?.email || '').catch(() => '');
    const answer = read(host), own = answer.ok ? emailOf(host) : '';
    // This app's Keychain holds only what the harness seeded (a TEST account, lib/test-accounts.mjs), so an item here is always the account to sign in with, with ITS email: the page that asks for
    // it may be on another host than the posting (Adnovum: the posting on careers.adnovum.com, the login on career74.sapsf.eu), where the applicant's fake email would have made the product's own
    // rule (modeOf: the item must be the applicant's email) answer "sign up" (16 Oct 2026). No item: the product's rule, as before.
    const mode = own ? 'sign-in' : modeOf(storage.settings().siteAccounts, host, email, emailOf(host), !!answer.ok, ''), as = own || email;
    if (peek) return {ok: true, mode, email: as};
    return answer.ok && as ? {...answer, email: as, mode, automation: automationOf(storage.settings())} : {...answer};
  };
}
