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

    def test_only_the_newest_run_of_a_check_counts(self):
        """#2282: the body edit and the retitle each started the PR gate; the first run was cancelled, the second passed; ship read the cancelled one as a failure."""
        self.put('repos/o/r/commits/h1/check-runs?per_page=100', {'check_runs': [
            {'id': 2, 'name': 'Pull request checks', 'status': 'completed', 'conclusion': 'success'},
            {'id': 1, 'name': 'Pull request checks', 'status': 'completed', 'conclusion': 'cancelled'}]})
        self.put('repos/o/r/commits/h1/status', {'statuses': []})
        self.assertEqual([(c['name'], c['bucket']) for c in json.loads(self.sh('pr_checks o/r h1')[1])], [('Pull request checks', 'pass')])

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
