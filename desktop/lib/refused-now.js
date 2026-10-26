// The person's press of "Find jobs using your browser" for the sites that refused the engine (owner, 26 Oct 2026: "shouldn't start automatically in the
// backgruond. It should be suggested to the user as an action button"; rule: CLAUDE.md, the browser-reads exception). The ONE gate of every browser read:
// lib/refused-reads.js hands the extension sites only after press(), whoever asks (its one-minute look, an older extension's hourly timer); nothing else
// arms it (a run, a timer, app start, opening a job). Its only caller is the button's handler (lib/refused-reads-handlers.js). Guard: test/refused-reads-button.test.js.
let pressed = false;

export const hostOf = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
export function press() { pressed = true; }   // the person pressed the button: the extension's next look reads the due sites
export const pending = () => pressed;
export function take() { const was = pressed; pressed = false; return was; }   // a pass starts: one press, one pass
