// A live capture folder (npm run live: journey.json, pages/, ai-calls.json, app.log; no case.json) made into a replay candidate, so `npm run row-to-case -- <that folder> <case>` takes it as it is
// (12 Oct 2026: fix-import-dialog had to call saveCandidate from a scratch script). The candidate is written to a temp folder with the pool's own saveCandidate: the same case.json, presses and answers as a smoke run.
// Guard: e2e/test/record/bare-capture.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {saveCandidate} from './replay-candidate.mjs';

const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

// A folder with a journey and no case.json of its own.
export const isBareCapture = dir => { try { return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'journey.json')) && !fs.existsSync(path.join(dir, 'case.json')); } catch { return false; } };

// -> {dir (the candidate folder, with its case.json), cleanup()}
export function candidateFromCapture(captureDir) {
  const journey = JSON.parse(read(path.join(captureDir, 'journey.json')) || '[]');
  if (!journey.length) throw new Error(`${captureDir}: journey.json holds no pages`);
  const appLog = read(path.join(captureDir, 'app.log')), main = journey.find(page => !page.frameOf) || journey[0];
  // The run's output shows the app's lines as "log hh:mm:ss.mmmZ [extension] ...": the candidate's evidence reads that shape.
  const output = appLog.split('\n').map(line => line.replace(/^\d{4}-\d\d-\d\dT([\d:.]+Z) /, 'log $1 ')).join('\n');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bare-capture-'));
  const dir = saveCandidate({dir: root, day: 'bare', shape: path.basename(path.resolve(captureDir)), result: {url: main.url, reached: 'a live capture'}, html: '', output, aiCalls: read(path.join(captureDir, 'ai-calls.json')), captureDir, appLog, always: true});
  return {dir, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}
