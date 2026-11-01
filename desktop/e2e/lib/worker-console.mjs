// The extension's service-worker console of a live run (the fill's own errors and waits, which the app log never sees), kept in the run's capture folder beside
// app.log and ai-calls.json, on both live legs (lib/live-row.mjs plain node, lib/apply-live.mjs Electron). 12 Oct 2026, HelloFresh: the Electron leg's fill hung
// after a menu and nothing showed where. A restarted worker is followed too. Fake applicant only, local only. Guard: test/record/evidence-bundle.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const WORKER_CONSOLE = 'extension-console.log';
const MAX_LINES = 5000, MAX_CHARS = 500;

// context: a Playwright browser context (serviceWorkers(), 'serviceworker' event). -> {lines(), write(dir) -> the file or '' when nothing was heard}
export function keepWorkerConsole(context, {now = Date.now} = {}) {
  const lines = [], watched = new Set();
  const watch = worker => {
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    worker.on('console', message => { if (lines.length < MAX_LINES) lines.push(`${new Date(now()).toISOString()} ${message.type()} ${String(message.text()).replace(/\s+/g, ' ').slice(0, MAX_CHARS)}`); });
  };
  for (const worker of context.serviceWorkers()) watch(worker);
  context.on('serviceworker', watch);
  return {
    lines: () => lines.slice(),
    write(dir) {
      if (!dir || !lines.length) return '';
      fs.mkdirSync(dir, {recursive: true});
      const file = path.join(dir, WORKER_CONSOLE);
      fs.writeFileSync(file, `${lines.join('\n')}\n`);
      return file;
    },
  };
}
