// A journey test: replays a recorded network record (replay-net.mjs) with the real extension and the app, reads the card and the panel at every step, and checks what the
// person saw against the live run (lib/journey-check.mjs). Exits 1 on any failure, printing the timeline.
//   node journey.mjs <record dir> <out dir>          (the replay's own flags after them, e.g. --cpu=4)
// The same through `npm run journey -- <record dir> <out dir>`. Writes <out>/journey-steps.json and <out>/journey-verdict.json. Guard: e2e/test/journey-check.test.mjs.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {journeyRows} from './journey-run.mjs';
import {checkJourney} from './lib/journey-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const timeline = steps => steps.map(({at, card, panel}) => `${String(at).padStart(5)}s  card "${card.words}"${card.total ? ` ${card.total - card.left}/${card.total}` : ''}  panel ${panel.present ? `${panel.open ? 'open' : 'pill'} ${JSON.stringify(panel.pill || panel.headline || '')} report=${panel.report}` : 'none'}`).join('\n');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [recordDir, out, ...rest] = process.argv.slice(2);
  if (!recordDir || !out) { console.error('usage: node journey.mjs <record dir> <out dir> [replay flags]'); process.exit(2); }
  const ran = spawnSync(process.execPath, [path.join(here, 'replay-net.mjs'), recordDir, out, '--journey', ...rest], {stdio: 'inherit'});
  const stepsFile = path.join(out, 'journey-steps.json');
  if (ran.status !== 0 || !fs.existsSync(stepsFile)) { console.error(`journey: the replay did not finish (exit ${ran.status}): nothing to judge`); process.exit(3); }
  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  let liveLog = ''; try { liveLog = fs.readFileSync(path.join(recordDir, 'app.log'), 'utf8'); } catch { /* a record without its log: the replay's own marks only */ }
  const name = (() => { try { return JSON.parse(fs.readFileSync(path.join(recordDir, 'record.json'), 'utf8')).name; } catch { return ''; } })();
  const verdict = checkJourney({steps, liveLog, blessed: journeyRows().find(one => one.row === name)?.marks || []});
  fs.writeFileSync(path.join(out, 'journey-verdict.json'), `${JSON.stringify(verdict, null, 1)}\n`);
  console.log(`journey: card marks, replay ${verdict.marks.replay.join(' > ') || '-'} | live ${verdict.marks.live.join(' > ') || '-'}\n${timeline(steps)}`);
  for (const failure of verdict.failures) console.log(`journey: FAIL ${failure}`);
  console.log(`journey: ${verdict.failures.length ? 'FAILED' : 'passed'} (${steps.length} steps)`);
  process.exit(verdict.failures.length ? 1 : 0);
}
