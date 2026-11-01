// What the harness asks the offline app to do, as the app's own window would (speed-5x landing 3: a live run without Electron). One JSON line per command on the
// app process's stdin ({id, cmd, args}), one JSON line per answer on its stdout ({id, ok, result | error}); an Apply hands its address to the harness browser as
// {event: 'open', url} (the app would launch Chrome). Each command calls the same function the window's IPC handler calls (lib/apply-handlers.js applyOne ->
// lib/apply.js applyOne, lib/contact-handlers.js saveContact -> lib/contact.js save, lib/setup-handlers.js saveSettings -> storage.saveSettings).
// Used by lib/offline-app-child.mjs; driven by lib/offline-app.mjs call(). Guard: e2e/test/replay/offline-app.test.mjs.
import readline from 'node:readline';

export function serveCommands(storage, {out = line => process.stdout.write(`${line}\n`)} = {}) {
  const say = value => out(JSON.stringify(value));
  const commands = {
    settings: async () => storage.settings(),
    saveSettings: async patch => storage.saveSettings(patch || {}),
    saveContact: async contact => { await (await import('../../lib/contact.js')).save(storage, contact || {}); return {ok: true}; },
    // The window's Apply: the session starts as the app starts it; the address goes to the harness browser; the engine's "applying" mark is not run (no Python here).
    applyOne: async (url, details) => (await import('../../lib/apply.js')).applyOne(storage, url, details || {}, {
      open: (command, args) => { say({event: 'open', url: [...(args || [])].reverse().find(arg => /^https?:\/\//.test(arg)) || ''}); return {on: () => {}, unref: () => {}}; },
      run: async () => ({ok: true}),
    }),
    sessions: async () => (await import('../../lib/terminals.js')).list(),
    // The person's "Use" on every proposed answer a harness run may take (lib/proposals-to-use.mjs): queued for the form's panel, which fills it through the extension. Never a press of Submit.
    useProposals: async done => {
      const {proposalsToUse} = await import('./proposals-to-use.mjs'), review = await import('../../lib/review.js');
      const {use, skipped} = proposalsToUse(review.allStates(), new Set(done || []));
      for (const item of use) review.queueFill(item.id, item.label, item.value);
      return {used: use.map(item => item.key), skipped: skipped.map(item => `${item.label}: ${item.why}`)};
    },
    reviewStates: async () => (await import('../../lib/review.js')).allStates(),   // the panel's counts and the page step per session: what the card reads (lib/journey-watch.mjs)
  };
  readline.createInterface({input: process.stdin}).on('line', async line => {
    let id = null;
    try {
      const {id: asked, cmd, args = []} = JSON.parse(line);
      id = asked;
      if (!commands[cmd]) throw new Error(`unknown command: ${cmd}`);
      say({id, ok: true, result: await commands[cmd](...args)});
    } catch (error) { say({id, ok: false, error: String(error?.message || error)}); }
  });
}
