// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the words of the one consent and the Suggestions entry, and
// when the ask is due. Pure, so test/linkedin-consent.test.js checks them; pages/linkedin-consent.js draws the dialog, and the four doors (Settings, Find jobs ask, Suggestions, ⌘K) open it.
export const KEY = 'linkedin:jobs';
// The owner's line (31 Oct 2026: "LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches.").
export const LINE = 'LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches.';
const WHERE = 'Settings → Connections → LinkedIn';
const LEAD = `Jobadabra can read your LinkedIn job searches every time you press Find jobs: in the background, with no window, using your LinkedIn sign-in from Chrome. The sign-in stays on this Mac, and you can turn it off any time in ${WHERE}.`;

export const CONSENT = {
  ask: {title: 'Also search LinkedIn on every Find jobs?', lead: LEAD, line: LINE, yes: 'Turn on LinkedIn', no: 'Not now'},
  'turn-on': {title: 'Also search LinkedIn on every Find jobs?', lead: LEAD, line: LINE, yes: 'Turn on LinkedIn', no: 'Not now'},
  manage: {title: 'LinkedIn jobs is on', lead: 'Every Find jobs also reads your LinkedIn job searches in the background, with your LinkedIn sign-in from Chrome kept in this Mac\'s Keychain. Turning it off deletes that sign-in.', line: '', yes: 'Turn off', no: 'Keep on'},
};

/** The Suggestions entry while the switch is off; `view` is the window's read of the state (pages/linkedin-consent.js), `hidden`/`held` the keys answered Not now. */
export function linkedinEntries({view, hidden = new Set(), held = new Set()} = {}) {
  if (!view?.loaded || view.on || hidden.has(KEY) || held.has(KEY)) return [];
  return [{kind: 'linkedin', home: 'focus', topic: 'profile', key: KEY, title: 'Also search LinkedIn when you find jobs', source: '',
    detail: 'In the background, no window. Uses your LinkedIn sign-in from Chrome.', evidence: [], answers: ['Not now'], actions: [{label: 'Turn on LinkedIn', do: 'turn_on_linkedin'}]}];
}

/** The ask on Find jobs: only a real Find jobs press (a re-score or Find employers goes through the same call), and only while the app says it is due. */
export const askOnPress = (view, why) => !!view?.ask && !(why && (why.reason || why.employers));
