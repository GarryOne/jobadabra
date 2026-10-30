"""tools/pr-rest-lib.sh (27 Oct 2026, the owner's GraphQL budget ran out and PRs could not be opened): the PR loops read REST with the last ETag, a 304 answers from the
cache for free, and the answers keep the `gh pr view` / `gh pr checks` shape. A fake `gh` (tests/fake_gh_rest.py) answers from files; no network."""
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / 'tools' / 'pr-rest-lib.sh'


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash') and shutil.which('git'), 'needs jq, bash and git')
class PrRestLibTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh_rest.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        self.env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'PR_REST_CACHE': str(self.tmp / 'cache')}

    def put(self, path, body):
        f = self.tmp / 'rest' / re.sub(r'[^A-Za-z0-9]', '_', path)
        f.parent.mkdir(exist_ok=True)
        f.write_text(json.dumps(body))

    def sh(self, script, cwd=None):
        r = subprocess.run(['bash', '-c', f'. "{LIB}"; {script}'], capture_output=True, text=True, env=self.env, cwd=cwd, timeout=30)
        return r.returncode, r.stdout.strip()

    def calls(self):
        return (self.tmp / 'calls').read_text().splitlines() if (self.tmp / 'calls').exists() else []

    def test_an_unchanged_answer_is_asked_with_its_etag_and_served_from_the_cache(self):
        self.put('repos/o/r/pulls/7', {'number': 7, 'state': 'open'})
        first = self.sh('pr_get repos/o/r/pulls/7')
        second = self.sh('pr_get repos/o/r/pulls/7')
        self.assertEqual(first, second)
        self.assertEqual(json.loads(second[1])['number'], 7)
        self.assertNotIn('If-None-Match', self.calls()[0])
        self.assertIn('If-None-Match: W/"', self.calls()[1], 'the second read sends the ETag; the fake answers 304')

    def test_a_changed_answer_replaces_the_cache(self):
        self.put('repos/o/r/pulls/7', {'number': 7, 'state': 'open'})
        self.sh('pr_get repos/o/r/pulls/7')
        self.put('repos/o/r/pulls/7', {'number': 7, 'state': 'closed'})
        self.assertEqual(json.loads(self.sh('pr_get repos/o/r/pulls/7')[1])['state'], 'closed')

    def test_a_refused_or_missing_answer_fails_with_no_output(self):
        self.assertEqual(self.sh('pr_get repos/o/r/pulls/404'), (1, ''))

    def test_pr_view_and_pr_checks_keep_the_gh_shapes(self):
        self.put('repos/o/r/pulls/7', {'number': 7, 'html_url': 'u', 'head': {'sha': 'h1', 'ref': 'b'}, 'state': 'closed', 'merged_at': 't', 'merge_commit_sha': 'abc', 'mergeable': None})
        self.put('repos/o/r/issues/7/comments?per_page=100', [{'node_id': 'IC_1', 'user': {'login': 'gitar-bot[bot]'}, 'body': 'x', 'html_url': 'c', 'created_at': 't1'}])
        code, out = self.sh('pr_view o/r 7 full')
        v = json.loads(out)
        self.assertEqual((v['state'], v['mergeable'], v['mergeCommit'], v['headRefOid']), ('MERGED', 'UNKNOWN', {'oid': 'abc'}, 'h1'))
        self.assertEqual(v['comments'], [{'id': 'IC_1', 'author': {'login': 'gitar-bot[bot]'}, 'body': 'x', 'url': 'c', 'createdAt': 't1'}])
        self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': [
            {'id': 1, 'name': 'a', 'status': 'completed', 'conclusion': 'success', 'html_url': 'l'}, {'id': 2, 'name': 'b', 'status': 'completed', 'conclusion': 'timed_out'},
            {'id': 3, 'name': 'c', 'status': 'completed', 'conclusion': 'cancelled'}, {'id': 4, 'name': 'd', 'status': 'queued', 'conclusion': None}, {'id': 5, 'name': 'e', 'status': 'completed', 'conclusion': 'skipped'}]})
        self.put('repos/o/r/commits/h1/status', {'statuses': [{'context': 'All checks passed', 'state': 'error', 'target_url': 't'}]})
        checks = json.loads(self.sh('pr_checks o/r h1')[1])
        self.assertEqual([(c['name'], c['bucket']) for c in checks], [('a', 'pass'), ('b', 'fail'), ('c', 'cancel'), ('d', 'pending'), ('e', 'skipping'), ('All checks passed', 'fail')])

    def test_manual_and_old_head_runs_cannot_replace_the_pr_check(self):
        self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': [
            {'id': i, 'name': 'python', 'head_sha': sha, 'status': 'completed', 'conclusion': result,
             'html_url': f'https://github.com/o/r/actions/runs/{i}/job/{i}'}
            for i, sha, result in [(1, 'h1', 'success'), (2, 'h1', 'failure'), (3, 'old', 'failure')]]})
        self.put('repos/o/r/commits/h1/status', {'statuses': []})
        for i, sha, event in [(1, 'h1', 'pull_request'), (2, 'h1', 'workflow_dispatch'), (3, 'old', 'pull_request')]:
            self.put(f'repos/o/r/actions/runs/{i}', {'head_sha': sha, 'event': event})
        self.assertEqual([(c['name'], c['bucket']) for c in json.loads(self.sh('pr_checks o/r h1')[1])], [('python', 'pass')])

    def test_pr_verdict_status_can_link_to_a_workflow_run_on_main(self):
        self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': [
            {'id': 1, 'name': 'report', 'head_sha': 'main', 'status': 'completed', 'conclusion': 'failure',
             'html_url': 'https://github.com/o/r/actions/runs/2/job/1'}]})
        self.put('repos/o/r/actions/runs/2', {'head_sha': 'main', 'event': 'workflow_run'})
        for state, bucket in [('success', 'pass'), ('failure', 'fail')]:
            with self.subTest(state=state):
                self.put('repos/o/r/commits/h1/status', {'sha': 'h1', 'statuses': [
                    {'context': 'All checks passed', 'state': state, 'target_url': 'https://github.com/o/r/actions/runs/2'}]})
                self.assertEqual([(c['name'], c['bucket']) for c in json.loads(self.sh('pr_checks o/r h1')[1])],
                                 [('All checks passed', bucket)])

    def test_a_status_response_from_an_old_head_invalidates_the_read(self):
        self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': []})
        self.put('repos/o/r/commits/h1/status', {'sha': 'old', 'statuses': [
            {'context': 'All checks passed', 'state': 'failure'}]})
        self.assertEqual(self.sh('pr_checks o/r h1'), (1, ''))

    def test_a_status_pointing_at_a_manual_run_is_not_a_pr_failure(self):
        self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': []})
        self.put('repos/o/r/commits/h1/status', {'statuses': [
            {'context': 'All checks passed', 'state': 'failure', 'target_url': 'https://github.com/o/r/actions/runs/2'}]})
        self.put('repos/o/r/actions/runs/2', {'head_sha': 'h1', 'event': 'workflow_dispatch'})
        self.assertEqual(json.loads(self.sh('pr_checks o/r h1')[1]), [])

    def test_unreadable_actions_provenance_does_not_report_a_red(self):
        self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': [
            {'id': 1, 'name': 'python', 'head_sha': 'h1', 'status': 'completed', 'conclusion': 'failure',
             'html_url': 'https://github.com/o/r/actions/runs/1/job/1'}]})
        self.put('repos/o/r/commits/h1/status', {'statuses': []})
        self.assertEqual(self.sh('pr_checks o/r h1'), (1, ''))

    def test_only_the_newest_run_of_a_check_counts(self):
        """#2282: the body edit and the retitle each started the PR gate; the first run was cancelled, the second passed; ship read the cancelled one as a failure."""
        self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': [
            {'id': 2, 'name': 'Pull request checks', 'status': 'completed', 'conclusion': 'success'},
            {'id': 1, 'name': 'Pull request checks', 'status': 'completed', 'conclusion': 'cancelled'}]})
        self.put('repos/o/r/commits/h1/status', {'statuses': []})
        self.assertEqual([(c['name'], c['bucket']) for c in json.loads(self.sh('pr_checks o/r h1')[1])], [('Pull request checks', 'pass')])

    def test_ship_ignores_tolerant_failures_but_still_fails_backbone_checks(self):
        """#2533: exercise ship's real wait loop; all mutations are disabled, REST is file-backed."""
        self.put('repos/o/r/contents/desktop/e2e/lanes.json?ref=main',
                 {'v': 1, 'suites': {'qualityai': {'lane': 'tolerant'}}})
        self.put('repos/o/r/pulls/7', {'number': 7, 'html_url': 'u', 'title': '[qu] Quality',
                                     'head': {'sha': 'h1', 'ref': 'topic'}, 'state': 'open', 'mergeable': True})
        self.put('repos/o/r/commits/h1/status', {'statuses': [{'context': 'All checks passed', 'state': 'success'}]})
        for failed, want, registry in [('qualityai', 0, True), ('qualityai-1of2', 0, True),
                                       ('settings', 1, True), ('qualityai', 1, False)]:
            with self.subTest(failed=failed, registry=registry):
                if not registry:
                    (self.tmp / 'rest' / 'repos_o_r_contents_desktop_e2e_lanes_json_ref_main').unlink()
                self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': [
                    {'id': 1, 'name': failed, 'status': 'completed', 'conclusion': 'failure'},
                    {'id': 2, 'name': 'python', 'status': 'completed', 'conclusion': 'success'}]})
                script = f'''source "{ROOT}/tools/ship-pr.sh"
tools="{ROOT}/tools"; branch=topic; SHIP_PR_TIMEOUT=0
git() {{ :; }}
ship_pr_no_stacking() {{ :; }}
ship_repo() {{ echo o/r; }}
pr_of_head() {{ echo 7; }}
ship_pr_push() {{ :; }}
ship_watch_start() {{ :; }}
ship_review() {{ return 0; }}
ship_flow_step_red() {{ return 1; }}
session_name() {{ echo '?'; }}
step() {{ echo "$*"; }}
ship_pr_land
echo "REVIEW $review_n"'''
                result = subprocess.run(['bash', '-e', '-c', script], env=self.env, cwd=self.tmp,
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, want, result.stdout + result.stderr)
                if want:
                    self.assertIn(f"check '{failed}' failed", result.stderr)
                else:
                    self.assertIn('REVIEW 7', result.stdout)
                    self.assertNotIn('ship: FAILED', result.stderr)

    def test_the_repo_comes_from_a_github_origin_only(self):
        for url, want in (('git@github.com:GarryOne/jobadabra-web.git', 'GarryOne/jobadabra-web'), ('https://github.com/GarryOne/jobadabra', 'GarryOne/jobadabra'),
                          ('/tmp/origin.git', '')):
            d = self.tmp / f'repo{len(want)}'
            subprocess.run(['git', 'init', '-q', str(d)], check=True)
            subprocess.run(['git', '-C', str(d), 'remote', 'add', 'origin', url], check=True)
            self.assertEqual(self.sh('pr_repo', cwd=d)[1], want, url)

    def test_the_pr_loops_ask_no_graphql(self):
        """The loops that look again and again: the watcher whole, ship-pr's wait. REST-capable one-off calls also use the helper; GraphQL-only draft-ready and auto-merge remain attributed."""
        watch = (ROOT / 'tools' / 'ship-watch.sh').read_text()
        self.assertNotRegex(watch, r'\bgh (pr|issue) |gh api graphql')
        ship_pr = (ROOT / 'tools' / 'ship-pr.sh').read_text()
        loop = ship_pr[ship_pr.index('  while :; do\n    view='):]
        loop = loop[:loop.index('\n  done\n')]
        self.assertNotRegex(loop, r'\bgh pr (view|checks)|gh api graphql')


if __name__ == '__main__':
    unittest.main()
