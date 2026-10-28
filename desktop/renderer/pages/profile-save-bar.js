// The Profile page's one save bar (owner, 18 Oct 2026, UI redesign D2): every edited field on its 5 tabs is a draft on this bar ("3 unsaved changes in Your details
// and Experience · Discard all · Save all changes"), kept while you switch tabs; each tab's cards register a source (save-bar.js). Made on first use so any tab's
// module can register without an import order. It sits in the page's bottom dock under the fold bar (#profile-dock: one sticky box, so neither covers the other). Leaving Profile with drafts asks (pages/settings.js settingsPage, nav.js guardLeave). Guarded by test/profile-page.test.js.
import {pageSaveBar} from '../save-bar.js';

export const PROFILE_TABS = {cv: 'CV', details: 'Your details', experience: 'Experience', answers: 'What we learned', letter: 'Cover letter'};
const tabButton = key => document.querySelector(`[data-profile-tab="${key}"]`);
let bar = null;
export function profileBar() {
  bar ||= pageSaveBar({host: document.getElementById('profile-dock') || document.querySelector('[data-settings-page="profile"]'), tabs: PROFILE_TABS, tabButton, openTab: key => tabButton(key)?.click(),
    words: 'Your drafts stay while you switch tabs. Forms, kits and letters use them once saved.', area: 'Profile'});
  return bar;
}
