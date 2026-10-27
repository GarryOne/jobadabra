// Scores a mutation run (mutation.yml): node mutation-score.mjs <runs.json> <out.json>. Prints the summary table, writes the result (kept as an artifact for
// /self-heal), and files one issue per mutant that SURVIVED (a serious code bug no suite caught: a detector gap), or comments "still missed" on its open one.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {issueActions, issueTitle, score, summary} from './lib/mutation.mjs';
import {SCORECARD_LABEL} from './lib/finder-scorecard.mjs';

const [runsFile, outFile] = process.argv.slice(2);
const mutants = JSON.parse(fs.readFileSync(new URL('./mutants.json', import.meta.url), 'utf8'));
const result = {...score(mutants, JSON.parse(fs.readFileSync(runsFile, 'utf8'))), at: new Date().toISOString()};
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
const text = summary(result);
console.log(text);
if (process.env.GH_TOKEN) {
  const gh = args => execFileSync('gh', args, {encoding: 'utf8'});
  gh(['label', 'create', 'detector-miss', '--force', '--color', 'B60205', '--description', 'A bug the Finder should have caught and did not']);
  const open = JSON.parse(gh(['issue', 'list', '--label', 'detector-miss', '--state', 'open', '--limit', '100', '--json', 'number,title']));
  const run = process.env.RUN_URL || '';
  const actions = issueActions(result, open);
  for (const {number} of actions.comment) gh(['issue', 'comment', String(number), '--body', `Still missed in ${run}.`]);
  for (const {number, row} of actions.close) gh(['issue', 'close', String(number), '--reason', 'completed', '--comment', `✅ Caught in ${run} (${row.why}).`]);
  for (const row of actions.create) {
    gh(['issue', 'create', '--label', 'detector-miss', '--title', issueTitle(row.id), '--body', [`> [!WARNING]`, `> A serious bug was written into the app on purpose and the \`${row.suite}\` suite stayed green.`, '',
      `**The bug:** ${row.what}`, `**Mutant:** \`${row.id}\` in \`desktop/e2e/mutants.json\``, `**Run:** ${run}`, '',
      `**Next:** add the check that would have caught it (a truth check, a step in \`${row.suite}\`), then the next mutation run kills it. Replay: \`gh workflow run e2e.yml -f suite=${row.suite} -f store=${row.store || 'alternate'} -f mutant=${row.id}\`.`].join('\n')]);
  }
  // The catch rate reaches the Finder's review (owner, 27 Oct 2026): the table goes on the pinned scorecard issue, beside the triage scorecards.
  const [card] = JSON.parse(gh(['issue', 'list', '--label', SCORECARD_LABEL, '--state', 'open', '--limit', '1', '--json', 'number']));
  if (card) gh(['issue', 'comment', String(card.number), '--body', `${text}\n\n${run}`]);
}
