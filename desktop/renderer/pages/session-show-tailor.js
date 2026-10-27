// Where the form panel's "Tailor in Jobadabra" lands (owner, 27 Oct 2026: "Send me to the app"): the session page, its "Before you submit" CV card in view and its Tailor
// button highlighted (the ⌘K palette's reveal on the CV row: scroll, one pulse; the button takes focus with its ring). Called by session-log.js on the app's 'open' event with show: 'tailor'. Guard: desktop/test/tailor-from-panel.test.js.
import {reveal} from './palette-busy.js';

/**
 * Wait for the session page's CV card (it is drawn after the CV state is read) and reveal its button, or the card when the button is not offered (tailored already, tailoring now).
 * @param {string} id the session the panel opened: its Tailor stays the page's main (solid) button until pressed (session-form-card.js reads `data-suggested`)
 * @param {object} [seams] tests pass their own document, clock and timer
 * @returns {Promise<string>} what was revealed: 'button', 'card', or '' when the card never showed within `wait` ms (the page then stays as it opened)
 */
export function showTailor(id, {doc = globalThis.document, wait = 6000, every = 150, now = () => Date.now(), later = setTimeout} = {}) {
  const until = now() + wait;
  return new Promise(resolve => {
    const look = () => {
      const card = doc.getElementById('ss-before-cv'), button = doc.getElementById('ss-before-cv-btn');
      if (card && !card.hidden) {
        reveal(card);   // the CV row scrolls in and pulses (the ⌘K palette's landing)
        const offered = button && !button.hidden;
        if (offered) {   // the one thing to press: the row's main (solid) button, as the session page's next step does (session-next-step.js), and focused
          button.dataset.suggested = id;
          button.classList.replace('secondary', 'primary');
          button.focus({preventScroll: true, focusVisible: true});
        }
        return resolve(offered ? 'button' : 'card');
      }
      if (now() >= until) return resolve('');
      later(look, every);
    };
    look();
  });
}
