"""tools/red-main.sh (11 Oct 2026): main's state from the CI runs of its newest commits. The newest commit with a finished verdict decides; a fix still building proves nothing (the old exemption let four landings through on top of a fix that ended red); the counted workflows are listed in one place and every workflow is classified here."""
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools' / 'red-main.sh'
TESTS, PAGES = 'CI · Tests', 'CI · Page cases (all cases, real extension, Linux)'

# Every workflow of .github/workflows, counted for red main or ignored with the reason (a new workflow fails the last test until it is put here: a conscious choice).
CLASSIFIED = {
    'Extension · Web Store zip': 'ignored: by hand or on an extension-v* tag; builds the store package, never runs on a push to main',
    'CI · Tests': 'counted',
    "CI · Start the What's new publish": 'ignored: after a beta approval or a promotion to stable only, never on a push to main; it starts the site repo\'s publish and never fails a release',
    'Proof · LibreOffice add-on on Mac and Windows': 'ignored: pull requests that edit the add-on, and by hand; downloads LibreOffice for real on Mac and Windows runners, never on a push to main',
    'Proof · Which org the e2e AI keys belong to': 'ignored: pull requests that edit it, and by hand; a $0 check of the e2e keys, never on a push to main',
    'CI · Cancel the runs of a closed PR': 'ignored: pull_request_target on close; cancels the closed PR\'s own runs, never runs on main',
    'CI · Page cases (all cases, real extension, Linux)': 'ignored: pull requests and by hand only; on main its cases are a step of CI · Tests (one Linux job, 15 Oct 2026)',
    'CI · Pull request': 'ignored: runs on pull requests only, never on main; its checks gate the merge',
    'E2E · Bisect a red main suite': 'ignored: started by e2e.yml after a red main suite (gate G2b); it bisects, it never runs on a push to main',
    'E2E · Weekly root causes': 'ignored: a Monday report (gate G6); it reads runs and writes one issue, never runs on a push to main',
    'CI · E2E suites for a PR': 'ignored: runs on pull requests only (on: paths:), never on main; its red blocks the PR through All checks passed',
    'CI · Hosted Always on e2e': 'ignored: pull requests that touch the hosted code, and nightly; never on a push to main',
    'CI · Harness tests': 'ignored: pull requests that change the harness only (on: paths:)',
    'CI · Harness tests · daily': 'ignored: its own daily run alerts the CI chat; not a main push check',
    'CI · Tests · python': 'ignored: on main it runs inside CI · Tests (build.yml calls it); alone only on pull requests',
    'CI · Tests · worker': 'ignored: on main it runs inside CI · Tests (build.yml calls it); alone only on pull requests',
    'CI · Tests · site': 'ignored: on main it runs inside CI · Tests (build.yml calls it); alone only on pull requests',
    'CI · Tests · desktop': 'ignored: on main it runs inside CI · Tests (build.yml calls it); alone only on pull requests',
    'CI · Tests · desktop (Windows)': 'ignored: on main it runs inside CI · Tests (build.yml calls it); alone only on pull requests that change a file with a platform branch',
    'CI · Flow e2e (apply + applyflows, optional)': 'ignored: runs on pull requests only (an optional check), never on main',
    'CI · Lab Job Search · heal stale tapes': 'ignored: a daily heal of a test tape, off until LAB_HEAL_ON; a failed heal leaves the old tape',
    'CI · Lab Job Search · PR replay (offline)': 'ignored: pull requests that touch the search only, never on main; a real Worse fails the PR, a stale tape does not',
    'CI · Lab Job Search · replay (offline)': 'ignored: on a push to main that touches the search, daily and by hand; a worse or stale candidate shows on /admin/lab-job-search, it is not a red main',
    'CI · Site replays · all (offline)': 'ignored: scheduled once a day, alerts on a real drop by itself, never required',
    'CI · Fix verdicts (offline replays)': 'ignored: informational verdicts for /admin/lab-form-filling after the nightly replay, never required',
    'CI · Journeys (card and panel per step)': 'ignored: by hand only, tells Telegram itself, never required',
    'CI · Replay refill': 'ignored: by hand, or on main after a prompt change; a failed run sends its own Telegram alert and must never block a push',
    'CI · End-to-end on Mac + Linux': 'ignored: the e2e suites run on schedule and by hand with live-site and AI flakiness; a red one is an issue, not a block on every landing',
    'CI · End-to-end on Windows': 'ignored: same, slower and by schedule', 'CI · Python tests on Windows (by hand)': 'ignored: started by hand',
    'CI · Mac smoke (by hand)': 'ignored: by hand', 'Spike · Windows Store package (MSIX)': 'ignored: by hand, a one-off spike', 'Build · Windows Store package (MSIX)': 'ignored: by hand, owner uploads the file', 'CI · Pool smoke (by hand)': 'ignored: by hand, live sites', 'CI · Record sites (by hand)': 'ignored: by hand, live sites', 'CI · Daily watch list': 'ignored: daily, live sites', 'CI · Random draw (every 2nd day)': 'ignored: daily, live sites, a weak draw is data not a red main', 'CI · Edge check (Windows, by hand)': 'ignored: by hand', 'CI · Windows smoke (weekly)': 'ignored: weekly',
    'Release · Build, test, beta': 'ignored: the release run, its own gates and rollback (pipeline gates)', 'Release · Promote to stable': 'ignored: release', 'Release · Guard Latest': 'ignored: release; hourly check that only a desktop build is Latest', 'CI · Promotion dry run': 'ignored: release rehearsal',
    'CI · Release to beta': 'ignored: release', 'CI · Stable canary': 'ignored: release', 'Release · Website': 'ignored: site deploy', 'Release · Ready to send runner': 'ignored: site deploy', 'CI · Ready to send image': 'ignored: pull requests only, never main', 'Release · Website preview (next)': 'ignored: site deploy',
    'Release · Product media': 'ignored: makes the site\'s pictures and videos after a screen change; a broken scene fails its own run, not main\'s tests',
    'Release · Worker': 'ignored: worker deploy', 'CI · Judge exam': 'ignored: AI eval', 'CI · Control tests (measure, not required)': 'ignored: a measure of the fill ladder; a miss never fails it', 'CI · Mutation test': 'ignored: nightly measurement',
    'CI · AI code review': 'ignored: advice on a PR', 'CI · AI cost billed': 'ignored: report', 'CI · Schedule watchdog': 'ignored: report', 'CI · Hosted Always on cost probe (one-off)': 'ignored: pull requests (a label) and by hand only, never main', 'CI · Server proof (one-off)': 'ignored: pull requests (a label) and by hand only, never main', 'CI · Self-heal stats': 'ignored: report', 'CI · Ops overview': 'ignored: report', 'CI · E2E intelligence': 'ignored: report', 'CI · Daily build digest': 'ignored: report', 'CI · PR checks scorecard': 'ignored: report', 'CI · Changelog publish': 'ignored: report',
    'CI · UI findings': 'ignored: UI loop', 'CI · UI fixer': 'ignored: UI loop', 'CI · UI verdicts': 'ignored: UI loop', 'CI · Top issues list': 'ignored: UI loop', 'CI · Bug Tracker rows': 'ignored: UI loop', 'CI · Fixed-issue labels': 'ignored: UI loop',
    'CI · Sentry fixer': 'ignored: fixer loop', 'UI loop · Finder self-review': 'ignored: UI loop',
    'Pipeline · Find new jobs': 'ignored: product pipeline', 'Pipeline · Gmail and Calendar': 'ignored: product pipeline', 'Pipeline · Find new employers': 'ignored: product pipeline',
    'Product brain · Daily brief': 'ignored: report',
    'Lab CI': "ignored: lab PRs (dispatched by ship.sh), a 20-minute sweep and a daily run of the private lab's tests; it never runs on a push to main and must never block a landing here",
    'Central scout':"ignored: scheduled every 6 h; a failed run tells the owner on Telegram by itself and must never block a push",
}


@unittest.skipUnless(shutil.which('bash') and shutil.which('jq') and shutil.which('git'), 'needs bash, jq and git')
class RedMainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = self.tmp / 'repo'
        self.repo.mkdir()
        git = lambda *a: subprocess.run(['git', '-C', str(self.repo), '-c', 'user.email=t@t', '-c', 'user.name=t', *a], check=True, capture_output=True, text=True).stdout.strip()
        git('init', '-q', '-b', 'main')
        self.shas = []
        for n in range(6):
            (self.repo / 'f').write_text(str(n))
            git('add', '-A'); git('commit', '-qm', f'c{n}')
            self.shas.append(git('rev-parse', 'HEAD'))
        git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        bin_dir = self.tmp / 'bin'; bin_dir.mkdir()
        state = (self.tmp / 'gh').as_posix()
        (self.tmp / 'gh').mkdir()
        (bin_dir / 'gh').write_text('#!/bin/bash\n'
                                    f'state="{state}"\n'
                                    'case "$1 $2" in\n'
                                    '  "run list") cat "$state/runs.json" ;;\n'
                                    '  "run view") id="$3"; q=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && q="$2"; shift; done; jq -r "$q" "$state/jobs-$id.json" 2>/dev/null || echo 0 ;;\n'
                                    '  "run rerun") echo "$3" >> "$state/reruns" ;;\n'
                                    'esac\n')
        (bin_dir / 'gh').chmod(0o755)
        self.bin = bin_dir
        self.runs = []
        self.next_id = 100

    def run_at(self, commit, workflow, status='completed', conclusion='success', failed_jobs=0):
        self.next_id += 1
        self.runs.append({'workflowName': workflow, 'headSha': self.shas[commit], 'status': status, 'conclusion': conclusion if status == 'completed' else '', 'databaseId': self.next_id,
                          'updatedAt': f'2026-10-11T15:0{commit}:00Z', 'url': f'https://github.com/x/y/actions/runs/{self.next_id}'})
        (self.tmp / 'gh' / f'jobs-{self.next_id}.json').write_text(json.dumps({'jobs': [{'conclusion': 'failure'}] * failed_jobs + [{'conclusion': 'success'}]}))

    def green_at(self, commit):
        self.run_at(commit, TESTS); self.run_at(commit, PAGES)

    def state(self):
        (self.tmp / 'gh' / 'runs.json').write_text(json.dumps(list(reversed(self.runs))))   # gh lists the newest first
        env = {'PATH': f'{self.bin.as_posix()}:{__import__("os").environ["PATH"]}', 'RED_MAIN_REPO': str(self.repo)}
        result = subprocess.run(['bash', str(SCRIPT)], capture_output=True, text=True, env=env, timeout=60)
        return result.stdout.strip(), result.returncode

    def test_green_when_the_newest_commit_with_a_verdict_is_green(self):
        self.green_at(3)
        self.assertEqual(self.state(), (f'green {self.shas[3][:7]}', 0))

    def test_the_old_name_of_page_cases_still_counts_until_28_oct_2026(self):
        self.run_at(3, TESTS); self.run_at(3, 'CI · Recorded pages (all cases, real extension, Linux)')
        self.assertEqual(self.state(), (f'green {self.shas[3][:7]}', 0))

    def test_red_names_the_commit_workflow_url_and_time(self):
        self.green_at(2)
        self.run_at(4, TESTS, conclusion='failure', failed_jobs=1); self.run_at(4, PAGES)
        out, code = self.state()
        self.assertEqual(code, 1)
        self.assertRegex(out, rf'^red\|{self.shas[4][:7]}\|CI · Tests\|https://\S+/runs/\d+\|2026-10-11T15:04:00Z\|\d+$')

    def test_a_fix_still_building_on_top_of_a_red_commit_does_not_unblock_anyone(self):
        # 11 Oct 2026: b6dd70e (a fix attempt) was building when others pushed; it ended red
        self.green_at(2)
        self.run_at(3, TESTS, conclusion='failure', failed_jobs=1); self.run_at(3, PAGES)
        self.run_at(4, TESTS, status='in_progress'); self.run_at(4, PAGES, status='in_progress')
        self.assertEqual(self.state()[1], 1, 'red until a later commit has a completed green run')

    def test_a_red_fix_does_not_unblock_and_a_green_one_does(self):
        self.green_at(1)
        self.run_at(2, TESTS, conclusion='failure', failed_jobs=1); self.run_at(2, PAGES)
        self.run_at(3, TESTS, conclusion='failure', failed_jobs=1); self.run_at(3, PAGES)   # the fix attempt is red too
        self.run_at(4, TESTS, status='in_progress')
        out, code = self.state()
        self.assertEqual((code, out.split('|')[1]), (1, self.shas[3][:7]), 'the newest verdict is the red fix attempt')
        self.green_at(5)
        self.assertEqual(self.state(), (f'green {self.shas[5][:7]}', 0))

    def test_a_running_build_with_a_failed_job_is_already_red(self):
        self.green_at(2)
        self.run_at(4, TESTS, status='in_progress', failed_jobs=1); self.run_at(4, PAGES, status='in_progress')
        self.assertEqual(self.state()[1], 1)

    def test_a_page_cases_run_is_not_counted_any_more(self):
        # 15 Oct 2026: main runs the page cases as a step of CI · Tests; a (by-hand) page-cases run neither makes main red nor is needed for green
        self.run_at(3, TESTS); self.run_at(3, PAGES, conclusion='failure', failed_jobs=1)
        self.assertEqual(self.state(), (f'green {self.shas[3][:7]}', 0))

    def test_a_commit_with_no_tests_run_yet_is_not_green_yet(self):
        self.green_at(1)
        self.run_at(3, PAGES)   # its CI · Tests run does not exist yet: the verdict falls to the commit before
        self.assertEqual(self.state(), (f'green {self.shas[1][:7]}', 0))

    def test_a_cancelled_run_of_the_newest_commit_blocks_nobody_and_is_rerun(self):
        self.green_at(1)
        self.run_at(5, TESTS, conclusion='cancelled'); self.run_at(5, PAGES)
        out, code = self.state()
        self.assertEqual(code, 0)
        self.assertEqual((self.tmp / 'gh' / 'reruns').read_text().split(), [str(self.runs[-2]['databaseId'])])

    def test_a_cancelled_run_of_an_older_commit_is_not_rerun(self):
        # 15 Oct 2026: a push to main cancels the older commit's runs (the newest commit's run decides); re-running them would take the runners back
        self.green_at(1)
        self.run_at(3, TESTS, conclusion='cancelled'); self.run_at(3, PAGES)
        out, code = self.state()
        self.assertEqual(code, 0)
        self.assertFalse((self.tmp / 'gh' / 'reruns').exists(), 'no re-run of a superseded commit')

    def test_no_gh_answer_is_unknown_and_never_blocks(self):
        env = {'PATH': '/usr/bin:/bin', 'RED_MAIN_REPO': str(self.repo)}
        result = subprocess.run(['bash', str(SCRIPT)], capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual((result.stdout.strip(), result.returncode), ('unknown', 0))

    def track(self):
        env = {'PATH': f'{self.bin.as_posix()}:{__import__("os").environ["PATH"]}', 'RED_MAIN_REPO': str(self.repo)}
        (self.tmp / 'gh' / 'runs.json').write_text(json.dumps(list(reversed(self.runs))))
        result = subprocess.run(['bash', str(SCRIPT), 'track'], capture_output=True, text=True, env=env, timeout=60)
        return result.stdout.strip(), result.returncode

    def reruns(self):
        path = self.tmp / 'gh' / 'reruns'
        return path.read_text().split() if path.exists() else []

    def test_a_red_run_gets_exactly_one_rerun_and_the_clock_does_not_move(self):
        self.green_at(1)
        self.run_at(3, TESTS, conclusion='failure', failed_jobs=1); self.run_at(3, PAGES)
        first, code = self.track()
        self.assertEqual(code, 1)
        self.assertEqual(len(self.reruns()), 1, 'the failed jobs are re-run once')
        self.runs[-2]['updatedAt'] = '2026-10-11T15:59:00Z'   # the re-run touched the run again: still red
        again, _ = self.track()
        self.assertEqual(len(self.reruns()), 1, 'never a second re-run of the same run')
        self.assertEqual(first.split('|')[4], again.split('|')[4], 'the 5 minute clock stays at the first red completion')

    def test_while_the_rerun_is_going_main_is_not_green_and_a_green_rerun_clears_the_red(self):
        self.green_at(1)
        self.run_at(3, TESTS, conclusion='failure', failed_jobs=1); self.run_at(3, PAGES)
        self.track()
        self.runs[-2].update({'status': 'in_progress', 'conclusion': ''})   # the re-run: no failed job showing, commit 3 unfinished, commit 1 green behind it
        (self.tmp / 'gh' / f'jobs-{self.runs[-2]["databaseId"]}.json').write_text(json.dumps({'jobs': [{'conclusion': None}]}))
        out, code = self.track()
        self.assertEqual((code, out.split('|')[0], out.split('|')[1]), (1, 'red', self.shas[3][:7]), 'the older green commit does not make main green while the red commit is being re-run')
        self.runs[-2].update({'status': 'completed', 'conclusion': 'success'})
        out, code = self.track()
        self.assertEqual((code, out), (0, f'green {self.shas[3][:7]}'))
        log = (self.repo / '.git' / 'gate-timing.log').read_text()
        self.assertRegex(log, r'red-main ended start=\S+ cause=CI_·_Tests sha=\S+ claim=- fix=\S+ minutes=')

    def test_every_workflow_is_classified_and_the_counted_ones_are_the_scripts_list(self):
        names = {re.search(r'^name:\s*(.+?)\s*$', p.read_text(), re.M).group(1).strip('"\'') for p in (ROOT / '.github' / 'workflows').glob('*.yml')}
        names = {re.sub(r'\((\d+ of )?\d+ pinned rows\)', '(N pinned rows)', n) for n in names}   # the PR replay check's name carries its counts ("<k> of <n> pinned rows")
        self.assertEqual(sorted(names - set(CLASSIFIED)), [], 'a workflow with no classification: add it to CLASSIFIED (counted or ignored with a reason)')
        listed = re.search(r'RED_WORKFLOWS=\(([^)]*)\)', SCRIPT.read_text()).group(1)
        counted = sorted(re.findall(r'"([^"]+)"', listed))
        self.assertEqual([c for c in counted if not any(n.startswith(c) and CLASSIFIED[n] == 'counted' for n in names)], [], 'every name in RED_WORKFLOWS is a counted workflow')
        self.assertEqual(sorted(n for n, how in CLASSIFIED.items() if how == 'counted' and n in names and not any(n.startswith(c) for c in counted)), [], 'every counted workflow is listed')


if __name__ == '__main__':
    unittest.main()
