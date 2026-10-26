// Builds the fixer brief for one cause from the By-cause groups: a ready, self-contained prompt (pure: fed the groups and a capture-folder listing, no network, no disk).
// Used by tools/needs-fix-causes.mjs --brief "<cause>". The recipe it prints is docs/rules/rounds.md step 3-4 and skill fix-recorded-sites section 0a. Guard: test/needs-fix-causes.test.js.

const slugOf = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const when = at => (at ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') : 'never run');
const QA_ROOT = '$HOME/Library/Application Support/Job Pilotto QA/replay-candidates';

// The freshest capture folder of a row: listing = {<day>: [folder names]}, the newest day whose folder name holds the row's slug (as lib/row-replay.mjs findRow does). -> 'day/folder' or ''.
export function captureOf(row, listing) {
  const wants = [row.name, row.shape].map(slugOf).filter(Boolean);
  for (const day of Object.keys(listing || {}).sort().reverse()) {
    const hit = (listing[day] || []).find(folder => wants.some(want => folder.includes(want)));
    if (hit) return day + '/' + hit;
  }
  return '';
}

const rowLine = row => `- "${row.name}": last run ${when(row.at)}, reached ${row.reached || 'none'}, filled ${Number.isInteger(row.filled) ? row.filled : '?'}, left ${Number.isInteger(row.left) ? row.left : '?'}`
  + (row.version ? `, build ${row.version}` : '') + (row.claimed ? ' (claimed by a session)' : '');

// groups: needsFixGroups(...) output. -> {ok, text}; ok false (text says why) for "Run first", an unknown cause, or no cause given.
export function buildBrief(groups, cause, listing, {oneLine = ''} = {}) {
  const known = groups.filter(group => group.key !== 'run-first');
  const group = groups.find(item => item.label.toLowerCase() === String(cause || '').toLowerCase());
  if (group && group.key === 'run-first') return {ok: false, text: 'run these first: "Run first" rows (never run, or no run since their fix) need a pool run, not a fix, so no fixer brief.\n' + group.rows.map((row, at) => `  ${row.name}  (${group.reasons[at] || 'needs a run'})`).join('\n')};
  if (!group) return {ok: false, text: `unknown cause "${cause || ''}". Known causes: ` + (known.map(item => `"${item.label}" (${item.count})`).join(', ') || 'none')};
  const slug = slugOf(group.label), session = 'job-pilotto-fix-' + slug;
  const captures = group.rows.map(row => ({row, folder: captureOf(row, listing)}));
  const rowBlocks = captures.map(({row, folder}) => [rowLine(row),
    '  capture: ' + (folder ? `${QA_ROOT}/${folder}` : 'none: ask the pool owner for a capture (one live run, ~1 min); do not hand-build a page instead'),
    `  replay: cd desktop/e2e && npm run row -- "${row.name}"`,
    `  case:   cd desktop/e2e && npm run row-to-case -- ${folder ? `"${QA_ROOT}/${folder}"` : `"${row.name}"`} ${slugOf(row.shape || row.name)}-${slug} --old-commit <your fix's commit hash> [--fixed]`].join('\n'));
  const text = [
    `You are session ${session} (Job Pilotto), one fixer for ONE cause, started by the coordinator job-pilotto-cc on the owner's paste. Report to job-pilotto-cc when each step lands.`,
    ...(oneLine ? ['', 'Coordinator\'s judgment: ' + oneLine] : []),
    '', `CAUSE: "${group.label}" (${group.count} row${group.count === 1 ? '' : 's'}, ${group.claimed} claimed). Rows, as /admin/form-filling/lab shows them:`,
    ...rowBlocks, '',
    'TARGET: rows of this cause Confirmed by a pool run (two clean runs by the pool owner on main). You land after the live row (step 3) and go idle; you never queue for the batch.', '',
    'Start with: tools/worktree.sh ' + slug + '; read .claude/skills/fix-recorded-sites/SKILL.md (section 0a) and docs/rules/rounds.md. Say the tier and the test method first. One fix for the shape of the cause, never a site (no site names, hosts or word lists).', '',
    'ORDER OF PROOF, fastest first (10 minutes per step, then use the real capture or tell job-pilotto-cc):',
    '1. The failing unit test, then 3 of 3 real asks of the app\'s AI on the saved page (`ladder-score`, plan path).',
    '2. The row replayed offline with its command above (15-90 s): it must reach further, and `--old` must not.',
    '3. A recorded case from the capture with the row-to-case command above (exit 3 = the old build passes, 4 = not provable; `--ask-cold` when the fix changes a prompt; `--old-commit <hash>` builds the old extension from your checkout with that commit taken out, or `--old <folder>` names one; `--fixed` when the capture was taken on a build that already has the fix: expect = the live run and the old build must fail it). Then ONE live run of the single row from your worktree, held, ~1 min (`npm run live -- <url>`), through the heavy lock.',
    '4. The pool owner\'s batch on main: not yours.', '',
    'RULES THAT BITE:',
    '- Never Submit; fake applicant data only; plan path (claude -p); the account-e-mail tripwire stays on; never the owner\'s live app, accounts or data.',
    '- No whole test suites by hand: lint plus the test files you touch; tools/ship.sh\'s gate runs the rest.',
    '- Claim the flow core before editing FLOW_CORE / FLOW_FILES (message every peer, read the file\'s "Invariants:" block, say "released" when done; claim-part for one function).',
    '- The commit message carries `Pool-row: <a row name from the list above, exactly>`; the commit hook refuses anything else.',
    '- Land with `tools/ship.sh --background` and arm a Monitor on its log; no edits in the worktree until DONE. Never remove another session\'s worktree.',
    '- Files stay at 500 lines or less; a new file starts with a one-line purpose comment. Tests also run on Windows and Linux CI.',
    '- No subagents. No new tooling during the round: a gap goes on a list.', '',
    'WHEN IT LANDS, report five lines to job-pilotto-cc: time per step (pick the cause, decide, code and failing tests, real asks, replay/capture, live row, ship), the ladder numbers, and the hash on origin/main.'].join('\n');
  return {ok: true, text};
}
