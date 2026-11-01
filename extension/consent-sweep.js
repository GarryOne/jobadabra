// A cookie banner that shows up late or is still open when the run ends (Fidag, 11 Oct 2026: the banner ships hidden and appears after the load, the one look at consent had passed): looked for again, cookies only, by the same closer. Guard: app-core/test/consent-sweep.test.js.
import {closeConsentEverywhere} from './consent.js';
import {decide} from './log.js';

// -> the label pressed, or ''. Never throws: a tab that is gone or a page that refuses a script is no reason to end a run differently.
export async function sweepConsent(tabId, why, close = closeConsentEverywhere) {
  const pressed = await close(tabId, {cookiesOnly: true}).catch(() => '');
  if (pressed) decide('fill', 'closed a cookie layer that was still open', {label: String(pressed).slice(0, 40), why});
  return pressed || '';
}
