// CI's report job of .github/workflows/page-cases.yml: every shard's replay results (JP_REPLAY_RESULTS files) sent to /admin/form-filling/lab's Fixed-site replays in
// ONE PUT with the build's sha, on a push to main only (lib/applying-report.mjs uploadReplays). A case without its control is held back (uploadable). A missing shard
// sends nothing: a partial run would drop its cases from the table. The ladder moves the passing cases confirmed go to the site's learning, marked source 'replay', on the same rule
// (lib/ladder-moves.mjs). Run: node replays-report.mjs <expected shard count> <results file>...
import fs from 'node:fs';
import {extensionVersion, replayReason, uploadable, uploadReplays} from './lib/applying-report.mjs';
import {distinctMoves, distinctRepairs, sendMoves} from './lib/ladder-moves.mjs';
import {originOfCase} from './lib/recorded-origin.mjs';
import {repoCounts} from './lib/repo-counts.mjs';

const [expected, ...files] = process.argv.slice(2);
const found = files.filter(file => fs.existsSync(file));
if (found.length !== Number(expected)) {
  console.log(`replays report: not sent (${found.length} of ${expected} shard results: a partial run would drop cases from the table)`);
} else {
  const results = found.flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const {rows, held} = uploadable(results, extensionVersion());
  for (const one of held) console.log(`replays report: ${one.name} held back, ${one.why}`);
  console.log(await uploadReplays(rows.map(({control, moves, fill, ...row}) => ({...row, origin: originOfCase('recorded', row.name)})), {repo: repoCounts()}));   // each case's origin, from its case.json
  // The ladder moves the passing cases confirmed go to the site's learning marked source 'replay' (lib/ladder-moves.mjs), on the same rule as the table: a push to main, not a dry run.
  const moves = distinctMoves(results.filter(item => item.ok).map(item => item.moves || []));   // a replayed move is one move (the site keeps it once), whichever cases saw it
  const notNow = replayReason() || (['1', 'true'].includes(String(process.env.JP_REPLAYS_DRY || '').toLowerCase()) ? 'a dry run' : '');
  console.log(notNow ? `ladder moves: not sent (${notNow}): ${moves.length} move(s) from ${results.filter(item => item.ok && item.moves?.length).length} case(s)` : await sendMoves(moves, {source: 'replay', repairs: distinctRepairs(results.filter(item => item.ok).map(item => item.repairs || []))}));
}
