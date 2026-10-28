// Settings → Profile → Your details over IPC: read and save the 📇 Contact details (lib/contact.js), and the values Claude proposes
// for the empty ones from the CV (lib/contact-from-cv.js). Moved out of main.js (8 Oct 2026). Guarded by test/contact-from-cv.test.js.
import * as contactDetails from './contact.js';
import * as fromCv from './contact-from-cv.js';
import {keysFor} from './contact-keys.js';
import * as sharedMeanings from './aliases.js';
import {proposalReporter} from './server-hooks.js';
import {pickOption} from './option-pick.js';
import {menuRearm} from './menu-rearm.js';
import * as review from './review.js';
import {aiClient} from './confirmation.js';
import {registerPreferencesHandlers} from './preferences-handlers.js';
import {registerDetailsFactsHandlers} from './details-facts-handlers.js';
import {registerGapsHandlers} from './gaps-handlers.js';
import {hashOf} from './cv-check.js';
import {profileTexts} from './strategy-settings.js';
import {byStore} from './store/words.js';

// Demo mode: fictional proposals, no AI (the screenshots of the Your details panel).
const DEMO_PROPOSALS = [{field: 'phone', value: '+44 20 7946 0000', sure: true}, {field: 'location', value: 'London', sure: true},
  {field: 'postal_code', value: 'SW1A 1AA', sure: true}, {field: 'salutation', value: 'Mr', sure: false}];

export function registerContactHandlers({ipcMain, storage, DEMO, connected, needsNotion, contactSaved, log}) {
  registerPreferencesHandlers({ipcMain, storage, DEMO, log});   // Settings → Profile → Preferences review (lib/preferences-handlers.js)
  registerDetailsFactsHandlers({ipcMain, storage, DEMO, connected, needsNotion, log});   // Your details' fact sections (lib/details-facts-handlers.js)
  registerGapsHandlers({ipcMain, storage, DEMO, connected, needsNotion, log});   // the Profile's CV gaps, one line each (lib/gaps-handlers.js)
  if (!DEMO) review.onState(menuRearm({storage, client: () => aiClient(storage), queueFill: review.queueFill, log}));   // a menu's choice by meaning
  ipcMain.handle('contact', () => (DEMO || !connected() ? {} : contactDetails.read(storage)));
  ipcMain.handle('saveContact', (_, contact) => needsNotion('profile') || contactDetails.save(storage, contact).then(saved => { contactSaved(saved || contact); return {ok: true}; })
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // One detail confirmed on the session page ("Use" on a row): merged into the others, never replacing them.
  ipcMain.handle('saveContactField', async (_, key, value) => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    if (!contactDetails.LABELS[key] || !String(value || '').trim()) return {ok: false, error: 'Nothing to save'};
    try {
      const saved = await contactDetails.save(storage, {...await contactDetails.read(storage), [key]: String(value).trim()});
      contactSaved(saved);
      log('profile', 'a detail saved from the session page', {field: key});
      return {ok: true};
    } catch (error) { return {ok: false, error: `Notion: ${error.message}`}; }
  });
  // Which contact detail each form label asks for (Claude reads labels it hasn't seen; kept per label).
  ipcMain.handle('contactKeysFor', async (_, labels) => (DEMO ? {} : keysFor(storage, Array.isArray(labels) ? labels.map(String) : [],
    {client: aiClient(storage), log, aliases: await sharedMeanings.lookup(storage).catch(() => []), propose: items => proposalReporter(items)})));
  // The form's own choice for an answer, when the field is a menu (lib/option-pick.js).
  ipcMain.handle('formChoiceFor', (_, ask) => (DEMO ? {choice: '', how: 'none'} : pickOption(storage, ask || {}, {client: aiClient(storage), log})));
  // {again}: read the CV anew (the button); otherwise what was proposed for this CV, or one Claude call when it was never read for this.
  ipcMain.handle('contactProposals', async (_, {again = false} = {}) => {
    if (DEMO) return {proposals: DEMO_PROPOSALS, fresh: false};
    if (!connected()) return {proposals: [], error: 'notion'};
    const contact = await contactDetails.read(storage).catch(() => null);
    if (!contact) return {proposals: [], error: byStore(storage, 'Couldn\'t read your details from Notion', 'Couldn\'t read your details from your Profile')};
    // What you stated beside the CV (Profile, Answers, Knowledge: contact-from-cv.js statedText): the town etc. the CV doesn't give.
    const {profile, answers} = await profileTexts(storage).catch(() => ({profile: '', answers: ''}));
    return fromCv.forCv(storage, {contact, client: aiClient(storage), cvHash: hashOf(storage), profile: fromCv.statedText({profile, answers}), again, log});
  });
}
