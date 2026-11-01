// The Applying flows' decisions in the app, out of main.js so they are unit-tested (docs/flows/applying.md): what a "can't reach the
// form" report from the extension does (account step, Claude's hand-over), which step each form report puts the session at, and the
// form tab Claude's hand-over closes. Scenarios owned: "Sign-up page before the form", "Claude takes over an account page",
// "Two applications side by side" (stuck reports). Guards: test/session-flow.test.js, the apply e2e rows (npm run flows).
// Every service is passed in (terminals, review, apply, the log, the window, startClaude), so a test drives these with fakes.
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. A stuck report from a tab the session has left is ignored (desktop/test/session-flow.test.js).
//  2. Claude is offered on a page the extension could not finish; this module never starts it. It starts only on the person's press in the panel or, with settings.claudeAuto,
//     after the panel's visible 5 s countdown with Cancel (owner, 10 Oct 2026; replaces "never started by itself") (desktop/test/session-flow.test.js).
//  3. The session is found one way (lib/journey-identity.js) and its step changes only through terminals.js -> lib/application-journey.js (desktop/test/journeys.test.js).

import {identityServices, resolveSession} from './journey-identity.js';
import {STUCK} from './application-journey.js';

const hostOf = url => { try { return new URL(String(url)).hostname; } catch { return ''; } };

export function createSessionFlow({terminals, review, apply, appLog, toWindow = () => {}, startClaude, claudeAllowed, closeTab, offerNotice = () => {}}) {
  const announced = new Set();   // sessions whose stuck page already got its "Claude can finish this" notice

  // The extension can't reach a form ('no-form': nothing it may press; 'account': a sign-in or sign-up). The tab's own session first (it
  // carries it: lib/review.js pick); only a tab carrying none is matched by its job. Returns what was decided, for the tests.
  function stuck(event) {
    const carried = event.session ? terminals.get(String(event.session)) : null;
    if (carried && review.olderTab(carried.id, event.tab)) {   // a page the session left (the posting behind its sign-in tab)
      appLog('review', `stuck report from an older tab of ${carried.id}: ignored`, {host: event.host, tab: event.tab ?? null, why: event.why});
      return 'older-tab';
    }
    // About a page the session's tab has left: its own tab has since reported a different page that is the application form.
    const pathOf = url => { try { const parsed = new URL(String(url)); return `${parsed.host}${parsed.pathname}`.replace(/\/$/, ''); } catch { return ''; } };
    const last = carried ? review.allStates().find(state => state.id === carried.id) : null;
    if (last && event.page && !last.account && last.total > 0 && pathOf(last.url) && pathOf(last.url) !== pathOf(event.page)) {
      appLog('review', `stuck report about a page ${carried.id}'s tab has left: ignored`, {host: event.host, why: event.why});
      return 'stale-page';
    }
    const match = carried ? (carried.kind === 'form' && !carried.outcome ? carried : null) : (terminals.get(resolveSession({job: event.job, url: event.url, boot: event.boot}, identityServices({terminals, review, isFormOf: apply.isFormOf}))) || null);   // lib/journey-identity.js: by the tab's job, then the page; never across browser runs
    appLog('extension', `can't reach the form: ${event.why}`, {host: event.host, matched: !!match, tab: event.tab ?? null, by: carried ? 'session' : 'job'});
    const why = STUCK.includes(event.why) ? event.why : 'no-form';   // the journey's one list of reasons (application-journey.js STUCK); anything else is 'no-form'
    // A Claude session on the same job at a sign-in page: its card says it is at the account step.
    const claudes = carried ? (carried.kind === 'claude' ? [carried] : []) : terminals.list().filter(session => session.kind === 'claude' && !session.outcome && apply.isFormOf(event.url, session.url) && !review.heldElsewhere?.(session.id, String(event.boot || '')));
    if (why === 'account') for (const other of claudes) terminals.setStage(other.id, 'account', event.host);
    if (!match) return 'no-session';
    if (!terminals.noteStuck(match.id, why, event.host, event.needs, event.accountStep) && match.stuck === 'account' && why === 'no-form') appLog('extension', 'no-form from an earlier tab: the account step stays', {host: event.host, id: match.id});
    if (why !== 'account') return 'noted';
    // Claude is OFFERED here, never started by this function (extension first; the person's press, or claudeAuto's 5 s countdown in the panel, starts it: takeOverHandler). The extension reports
    // an account page only when it could not finish it (its account AI was unsure, a bot check, something only the person can give): the session says what is needed.
    appLog('extension', `account page: the extension could not finish it: ${claudeAllowed?.() ? 'Claude is offered' : 'the person is told what is needed (no Claude: off, or an OpenAI engine)'}`, {host: event.host, id: match.id, ...(event.needs ? {needs: String(event.needs).slice(0, 60)} : {})});
    // The same offer as the page's panel, for whoever is not looking at the tab: a notice that opens the session's card (one per session; the card has the choices).
    if (claudeAllowed?.() && !announced.has(match.id)) { announced.add(match.id); offerNotice({id: match.id, host: event.host, company: match.company || ''}); }
    return 'offered';
  }

  // A form report (lib/review.js): the step the session is at, from the same page rule. An account page keeps it at the account
  // step (its fields are not the form's); the application form's fields move it to the form step and clear "can't reach the form".
  function reported(state) {
    if (state.account) { if (terminals.setStage(state.id, 'account', hostOf(state.url))) appLog('review', `stage ${state.id}: the account page`, {fields: state.total}); }
    // 'incomplete' (nothing filled) stays until something is filled
    else if (state.total > 0 && !(terminals.get(state.id)?.stuck === 'incomplete' && state.left >= state.total)) { terminals.clearStuck(state.id); if (terminals.setStage(state.id, 'form')) appLog('review', `stage ${state.id}: the application form`, {fields: state.total}); }
    appLog('review', `form ${state.id}: ${state.left}/${state.total} left, ${Object.keys(state.states || {}).length} watched field(s) seen`, {states: state.states});
    toWindow('review', state);
  }

  // Claude took the job: each of its form sessions' tabs closes when nothing was filled there (apply.formTabsAtHandOver), then the
  // form sessions go. The close is asked of the page before the session goes (its panel answers only to a session that exists).
  async function handOver(url) {
    const states = review.allStates();
    const filled = id => { const state = states.find(item => item.id === id); return state ? Math.max(0, (state.total || 0) - (state.left || 0)) : 0; };
    for (const entry of apply.formTabsAtHandOver(terminals.list(), url, filled)) {
      const session = terminals.get(entry.id);
      let closed = false;
      if (entry.close && session) { review.queueClose(entry.id); closed = !!(await closeTab(session).catch(() => false)); }
      appLog('review', `hand-over to Claude: form tab of ${entry.id} ${entry.close ? (closed ? 'closed' : 'not found') : 'kept'}`, {why: entry.why});
    }
    terminals.dropForm(String(url).split('#')[0]);
  }

  return {stuck, reported, handOver};
}
