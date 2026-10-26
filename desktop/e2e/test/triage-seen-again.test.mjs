// The self-healing loop's CLI (desktop/e2e/triage.mjs) on fake gh output: a run comments "Seen again" once per issue (split from triage-cli.test.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';

// #1711 (25-26 Oct 2026): runs posted "Seen again" twice, seconds apart: two findings of one run (the two boxes named in either order) matched the same
// issue, and the second checked the issue's comments as read before the first comment. One run, one "Seen again" per issue.
test('one run comments "Seen again" once on an issue, even when two of its findings match it', async () => {
  const {triage} = await import('../triage.mjs');
  const {matchExisting} = await import('../lib/triage-match.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const {normalize} = await import('../lib/triage.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-twice-'));
  const one = {view: 'wander', severity: 'medium', kind: 'duplicate-content', detail: 'div#setting-notify.setting.panel and div#hosted-ask share 88% of their words: "Notifications Tell me by: new matches, reminders and answers"'};
  const two = {...one, detail: 'div#hosted-ask and div#setting-notify.setting.panel share 88% of their words: "Your email Also send me product news and the Pro launch offer"'};
  for (const [leg, found] of [['e2e-artifacts-wander', one], ['e2e-artifacts-wander-standin', two]]) { fs.mkdirSync(path.join(dir, leg)); fs.writeFileSync(path.join(dir, leg, 'ui-findings.json'), JSON.stringify([found])); }
  const [a, b] = normalize({ui: [one, two]});
  const stored = [{number: 9, state: 'OPEN', title: `[auto-ui] wander: ${a.title}`, body: `🟠 **MEDIUM** · duplicate-content · found by the layout check\n\n### What was found\n${one.detail}\n\n### Reproduce`,
    labels: [{name: 'auto-ui'}, {name: `fp:${a.id}`}], comments: [{body: 'Seen again in run https://x/runs/1'}]}];
  assert.notEqual(a.id, b.id, 'positive control: two findings, not one');
  assert.equal(matchExisting(b, stored)?.number, 9, 'positive control: the second finding matches the same issue');
  const comments = [];
  const gh = args => {
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(stored);
    if (args[0] === 'pr') return '[]';
    if (args[0] === 'issue' && args[1] === 'comment') comments.push(args[2]);
    return '';
  };
  triage({artifacts: dir, runUrl: 'https://x/runs/2', gh});
  assert.deepEqual(comments, ['9'], 'one "Seen again" for the run');
});
