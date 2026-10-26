// The Finder's scorecard (lib/finder-scorecard.mjs): node finder-scorecard.mjs [--post] [--out file.md]. Needs gh. Prints the comment; --post adds it to the pinned issue
// labelled finder-scorecard (made once), where the previous scorecard is read back for the change. Run by the triage-github-open-issues skill at the end of each triage.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {SCORECARD_LABEL, previousOf, scorecard, scorecardComment} from './lib/finder-scorecard.mjs';
import {asIssues, REGISTER_LIST, registerEntries} from './lib/prejudge.mjs';

const args = process.argv.slice(2), at = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const gh = list => execFileSync('gh', list, {encoding: 'utf8', maxBuffer: 100 * 1024 * 1024});
const issues = JSON.parse(gh(['issue', 'list', '--label', 'auto-ui', '--state', 'all', '--limit', '1000', '--json', 'number,state,stateReason,labels,comments,createdAt,body']));
// Plus what was judged noise before filing (the noise register), as /admin/operations/self-healing counts it: still a false positive of its detector.
let judged = [];
try { judged = asIssues(registerEntries(JSON.parse(gh(REGISTER_LIST))[0]?.body)); } catch { judged = []; }
issues.push(...judged);
const home = JSON.parse(gh(['issue', 'list', '--label', SCORECARD_LABEL, '--state', 'open', '--limit', '1', '--json', 'number,comments']))[0] || null;
const comment = scorecardComment(scorecard(issues), previousOf(home?.comments || []));
console.log(comment);
if (at('--out')) fs.writeFileSync(at('--out'), comment);
if (args.includes('--post')) {
  let number = home?.number;
  if (!number) {
    gh(['label', 'create', SCORECARD_LABEL, '--force', '--color', '5319E7', '--description', 'The Finder scorecard, one comment per triage (desktop/e2e/finder-scorecard.mjs)']);
    const url = gh(['issue', 'create', '--title', '🎯 Finder scorecard', '--label', SCORECARD_LABEL, '--body', 'One comment per triage (the triage-github-open-issues skill): the Finder\'s precision by detector, why its false positives were false, how often a judge changed the filed severity, and the change since the last one. Kept open; never a bug.']).trim();
    number = Number(url.split('/').pop());
  }
  gh(['issue', 'comment', String(number), '--body', comment]);
  console.log(`posted on #${number}`);
}
