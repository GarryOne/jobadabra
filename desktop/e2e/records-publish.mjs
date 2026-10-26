// Publishes this Mac's pool network records for the PR replay (.github/workflows/site-replays.yml): the newest record per row in <records dir> is packed,
// encrypted with the repo's public key (desktop/e2e/net-record.pub.pem: only the owner's Keychain key and the NET_RECORD_KEY secret open it) and put on the
// GitHub release `net-records` of the PRIVATE repo jobadabra-lab (owner, 14 Oct 2026; CI reads it with NET_RECORDS_READ_TOKEN, net-records-fetch.sh) as a NEW bundle
// beside the others (14 Oct 2026: a publish that replaced the set would have dropped 11 of 18 rows; adding needs only the public key). The reader keeps the newest record per row
// across bundles. Decrypting (to edit a record's answers): the Keychain item job-pilotto.capture.key. Re-recording is by hand on the Mac (owner, 13 Oct 2026).
// A row the guard refuses is named with why and left out; the rows that pass are still published, and the command ends red (exit 1) for a safety refusal; a row that only needs a re-record (pinned / step) ends green and is listed by --report <file> (owner, 15 and 17 Oct 2026).
//   node records-publish.mjs <records dir> [--dry]      (record a row: JP_NET_RECORD_DIR=<records dir> npm run record-sites -- --only "<row>")
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {dispatchGh, uploadBundle} from './lib/refill-resilience.mjs';
import {newestPerRow} from './replay-records.mjs';
import {stampZone} from './lib/replay-date.mjs';
import {classify, judgeRecords, partition, report} from './lib/record-guard.mjs';
import {load as loadPins, pinned as pinnedRows} from './lib/replay-ratchet.mjs';
import {gateRecordDir, scrubRecordDir} from './lib/record-scrub.mjs';
import {appProfileTexts, personalValues} from '../lib/owner-values.js';

// One bundle's two assets, named by when it was published: net-records-<UTC stamp>.tgz.enc and .k.enc (the first set, before 14 Oct, is net-records.tgz.enc).
// suffix: two publishes in the same second (the refill's groups run in parallel) write different assets (NET_RECORDS_BUNDLE_SUFFIX, e.g. -g3).
export const bundleNames = (date = new Date(), suffix = '') => { const stamp = date.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; return {bundle: `net-records-${stamp}${suffix}.tgz.enc`, key: `net-records-${stamp}${suffix}.k.enc`}; };
export const TAG = 'net-records', REPO = process.env.NET_RECORDS_REPO || 'GarryOne/jobadabra-lab';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [root] = process.argv.slice(2), dry = process.argv.includes('--dry');
  if (!root) { console.error('usage: node records-publish.mjs <records dir> [--dry]'); process.exit(2); }
  const {bundle: BUNDLE, key: KEY} = bundleNames(new Date(), process.env.NET_RECORDS_BUNDLE_SUFFIX || '');
  const rows = newestPerRow(root), here = path.dirname(new URL(import.meta.url).pathname), work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-records-'));
  try {
    const stage = path.join(work, 'net-records');
    const values = personalValues(appProfileTexts()), leaks = new Map();   // the app's own profile values (lib/owner-values.js), as every capture scrubs with
    for (const row of rows) {
      const into = path.join(stage, path.basename(row.dir)), file = path.join(into, 'record.json');
      fs.cpSync(row.dir, into, {recursive: true});
      const record = JSON.parse(fs.readFileSync(file, 'utf8')), stamped = stampZone(record);   // a Mac record from before the zone was saved: this Mac's zone
      if (stamped !== record) fs.writeFileSync(file, JSON.stringify(stamped));
      // The person's own values and any e-mail address leave the record before it is packed (a signed-in row's pages carry the test account's address): lib/record-scrub.mjs, the product's report-scrub
      // definitions. What is left after it is searched again; a hit keeps the row off the release. Counts and kinds only are printed.
      const gone = scrubRecordDir(into, values), left = gateRecordDir(into, values);
      if (gone.bodies || gone.files) console.log(`records-publish: ${row.name}: scrubbed ${gone.bodies} bod${gone.bodies === 1 ? 'y' : 'ies'} and ${gone.files} file(s) (own values ${gone.own}, e-mail addresses ${gone.contacts}, phones ${gone.phones})`);
      if (left.length) leaks.set(row.name, left);
    }
    console.log(`records-publish: ${rows.length} rows: ${rows.map(row => row.name).join(', ')}`);
    const flagValues = name => process.argv.flatMap((arg, at) => (arg === name ? [process.argv[at + 1]] : []));
    if (rows.length > 3 && !process.env.CI) { console.error(`records-publish: refused: ${rows.length} rows at once; the guard replays each one and more than 3 replay in CI. Publish at most 3 rows a time (a folder with only those rows).`); process.exit(1); }
    const replayOf = (from, name) => {   // one row's own replay on this Mac (replay-records.mjs, JP_REPLAY_ONLY): its fidelity record, or null
      const out = fs.mkdtempSync(path.join(work, 'guard-'));
      execFileSync(process.execPath, [path.join(here, 'replay-records.mjs'), from, out], {env: {...process.env, JP_REPLAY_ONLY: name, JP_WIDE_LOCAL: ''}, stdio: ['ignore', 'ignore', 'inherit']});
      const files = fs.existsSync(path.join(out, 'step4')) ? fs.readdirSync(path.join(out, 'step4')) : [];
      return files.length ? JSON.parse(fs.readFileSync(path.join(out, 'step4', files[0]), 'utf8')) : null;
    };
    const against = flagValues('--against')[0], released = against ? new Map(newestPerRow(against).map(row => [row.name, row])) : null;
    const judged = judgeRecords(rows.map(row => ({name: row.name, dir: row.dir, replay: replayOf(stage, row.name), replaced: released ? (released.has(row.name) ? replayOf(against, row.name) : null) : undefined})), {pins: pinnedRows(loadPins()), accepts: flagValues('--accept')});
    if (judged.refusals.length || judged.notes.length) console.error(report(judged));
    // One refused row never blocks its group (owner, 15 Oct 2026: one old Cloudera record and Aldi's charset kept 2 groups' good rows off the release): the rows that pass are published, each refused
    // row is named with why (above), and the run still ends red (exit 1) so a refusal is never silent.
    const {publish: passed, refused: guarded} = partition(rows, judged);
    for (const [name, left] of leaks) console.error(`records-publish: refused ${name}: a person's value is left after the scrub (${left.map(hit => `${hit.kind} in ${hit.in}`).join(', ')})`);
    const publish = passed.filter(row => !leaks.has(row.name)), refused = [...guarded, ...leaks.keys()];
    if (refused.length) console.error(`records-publish: refused ${refused.length} row(s): ${refused.join(', ')}; ${publish.length ? `publishing the other ${publish.length}: ${publish.map(row => row.name).join(', ')}` : 'nothing is left to publish'}.`);
    // Only the safety refusals end red; a row that needs a re-record ends green with a list (--report <file> writes it for the workflow's summary and the one yellow Telegram message; owner, 17 Oct 2026).
    const {rerecord, hard} = classify(judged, [...leaks.keys()]), refusedExit = hard.length ? 1 : 0, reportAt = flagValues('--report')[0];
    if (rerecord.length) console.error(`records-publish: ${rerecord.length} row(s) need a re-record (not a failure): ${rerecord.map(one => one.row).join(', ')}`);
    if (reportAt) fs.writeFileSync(reportAt, JSON.stringify({published: publish.map(row => row.name), rerecord, hard}));
    if (dry || !publish.length) { fs.rmSync(work, {recursive: true, force: true}); process.exit(refusedExit); }
    for (const row of rows) if (refused.includes(row.name)) fs.rmSync(path.join(stage, path.basename(row.dir)), {recursive: true, force: true});
    const run = (cmd, args) => execFileSync(cmd, args, {cwd: work, stdio: ['ignore', 'pipe', 'inherit']});
    const gh = args => execFileSync('gh', args, {cwd: here, stdio: ['ignore', 'pipe', 'inherit']});   // from the repo: gh finds which repo the release is on
    run('tar', ['czf', 'net.tgz', 'net-records']);
    run('openssl', ['rand', '-hex', '-out', 'k', '32']);
    run('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', 'net.tgz', '-out', BUNDLE, '-pass', 'file:k']);
    run('openssl', ['pkeyutl', '-encrypt', '-pubin', '-inkey', path.join(here, 'net-record.pub.pem'), '-pkeyopt', 'rsa_padding_mode:oaep', '-in', 'k', '-out', KEY]);
    fs.rmSync(path.join(work, 'k')); fs.rmSync(path.join(work, 'net.tgz'));
    try { gh(['release', 'view', TAG, '-R', REPO]); } catch { gh(['release', 'create', TAG, '-R', REPO, '--prerelease', '--title', 'Pool network records (encrypted)', '--notes', 'Encrypted pool network records for the PR replay (desktop/e2e/records-publish.mjs). Not an app build.']); }
    uploadBundle(file => gh(['release', 'upload', TAG, '-R', REPO, file]), path.join(work, BUNDLE), path.join(work, KEY));   // the key last; each file retried (HTTP 404 once on 15 Oct 2026, group 3)   // added, never --clobber: other bundles stay
    console.log(`records-publish: ${publish.length} rows added to ${REPO} release ${TAG} as ${BUNDLE}`);
    // New recordings: main's replay runs again at once, so /admin/form-filling/lab shows them (the workflow publishes from main only).
    const dispatch = dispatchGh();   // the run's own token: the write token only reaches the private records repo
    try { execFileSync('gh', ['workflow', 'run', 'CI · Site replays · all (offline)', '--ref', 'main', ...dispatch.repoArgs], {cwd: here, env: dispatch.env, stdio: ['ignore', 'pipe', 'inherit']}); console.log('records-publish: replay on main started'); } catch { console.log('records-publish: start the replay on main by hand (gh workflow run "CI · Site replays · all (offline)" --ref main)'); }
    process.exitCode = refusedExit;
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}
