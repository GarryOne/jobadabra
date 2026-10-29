"""A revert preview proves its evidence and changes no branches or files."""
import copy
import json
import os
import shutil
import subprocess

from tests.ship_fixture import ShipFixture, git, ROOT


class RevertRedTest(ShipFixture):
    def setUp(self):
        super().setUp()
        shutil.copy(ROOT / 'tools' / 'revert-red.sh', self.main / 'tools' / 'revert-red.sh')
        (self.main / 'tools' / 'pre-push-check.sh').write_text('#!/bin/sh\ncat > "$PAYLOAD_FILE"\n')   # records the push command ship.sh asks the hook about
        for name in ('backbone_red.py', 'e2e_causes.py', 'main_e2e_state.py'):
            shutil.copy(ROOT / 'tools' / name, self.main / 'tools' / name)
        registry = self.main / 'desktop/e2e/lanes.json'
        registry.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / 'desktop/e2e/lanes.json', registry)
        git(self.main, 'add', '-A'); git(self.main, 'commit', '-qm', 'Tools')
        git(self.main, 'push', '-q', 'origin', 'main')
        self.change(self.main, 'bad.txt', 'broken\n', 'Break the build')
        git(self.main, 'push', '-q', 'origin', 'main')
        self.bad = git(self.main, 'rev-parse', 'HEAD')
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'gh').write_text('#!/bin/sh\nexit 1\n')   # no answer: red-main.sh says "unknown"
        (bin_dir / 'gh').chmod(0o755)
        # HAND-MADE ids, times, logs, provenance; no recorded REST pair was supplied.
        self.data = json.loads((ROOT / 'tests/fixtures/backbone-red-red.json').read_text())
        for item in self.data['records']:
            item['run']['head_sha'] = self.bad
            item['run']['display_title'] = f'E2E after merge · {self.bad[:7]} · apply'
        self.data['main'] = {'sha': self.bad}
        self.data['pulls'] = [{'number': 42, 'merged_at': '2026-10-28T09:00:00Z',
                               'base': {'ref': 'main'}, 'merge_commit_sha': self.bad}]
        self.evidence = self.tmp / 'evidence.json'
        self.env = {**os.environ, 'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'JOB_PILOTTO_SESSION': 'test-session', 'PAYLOAD_FILE': str(self.tmp / 'payload.json'), 'GITHUB_REPOSITORY': 'GarryOne/jobadabra'}

    def revert(self, *args):
        self.evidence.write_text(json.dumps(self.data))
        return subprocess.run(['bash', str(self.main / 'tools' / 'revert-red.sh'), *args], cwd=self.main, capture_output=True, text=True, timeout=120, env=self.env)


    def snapshot(self):
        return (git(self.main, 'show-ref'), git(self.main, 'status', '--porcelain'),
                git(self.main, 'worktree', 'list', '--porcelain'), git(self.origin, 'show-ref'))

    def test_dry_run_prints_the_full_pr_and_changes_no_refs_or_files(self):
        before = self.snapshot()
        result = self.revert('--dry-run', self.bad, '--runs-json', str(self.evidence))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for text in (f'Revert {self.bad[:7]}: backbone red twice', f'revert-red-{self.bad[:7]}',
                     'Body:', 'Breaking merge: #42', '501/1', '501/2', 'owner merges'):
            self.assertIn(text, result.stdout)
        self.assertEqual(self.snapshot(), before)

    def test_red_green_flake_is_refused_without_changes(self):
        self.data['records'][-1]['jobs'][0]['conclusion'] = 'success'
        self.data['records'][-1]['run']['conclusion'] = 'success'
        before = self.snapshot()
        result = self.revert('--dry-run', self.bad, '--runs-json', str(self.evidence))
        self.assertEqual(result.returncode, 2)
        self.assertIn('flip', result.stdout + result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_tolerant_red_is_refused_using_the_real_registry(self):
        for item in self.data['records']:
            item['run']['display_title'] = item['run']['display_title'].replace('apply', 'quality')
            item['jobs'][0]['name'] = 'quality'
        result = self.revert('--dry-run', self.bad, '--runs-json', str(self.evidence))
        self.assertEqual(result.returncode, 2)
        self.assertIn('non-backbone', result.stdout + result.stderr)

    def test_preview_refuses_non_pr_or_obsolete_merge(self):
        for change in ('not-pr', 'old-head'):
            original = copy.deepcopy(self.data)
            if change == 'not-pr': self.data['pulls'][0]['merge_commit_sha'] = 'f' * 40
            else: self.data['main']['sha'] = 'b' * 40
            result = self.revert('--dry-run', self.bad, '--runs-json', str(self.evidence))
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn('merged PR' if change == 'not-pr' else 'head of main', result.stdout + result.stderr)
            self.data = original

    def test_recorded_evidence_and_force_cannot_authorize_writes(self):
        for flags in (('--runs-json', str(self.evidence)), ('--force',)):
            before = self.snapshot()
            self.assertEqual(self.revert(self.bad, *flags).returncode, 2)
            self.assertEqual(self.snapshot(), before)

    def test_unreadable_live_evidence_is_refused(self):
        before = self.snapshot()
        result = self.revert('--dry-run', self.bad)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('unreadable', result.stdout + result.stderr)
        self.assertEqual(self.snapshot(), before)

    def live_fake(self):
        """Serve only known REST paths; writes record PR creation and never contact GitHub."""
        self.env['EVIDENCE'] = str(self.evidence)
        fake = self.tmp / 'bin/gh'
        fake.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p = Path(os.environ['EVIDENCE'])
d = json.loads(p.read_text())
a = sys.argv[1:]
with open(p.with_suffix('.calls'), 'a') as f: f.write(json.dumps(a) + '\\n')
if a[:1] == ['api']:
    if a[1:4] == ['-X', 'POST', 'repos/GarryOne/jobadabra/pulls']:
        p.with_suffix('.body').write_text(next(x[5:] for x in a if x.startswith('body=')))
        print('https://github.com/GarryOne/jobadabra/pull/99'); sys.exit(0)
    path = a[1]
    if path.endswith('/commits/main'): out = d['main']
    elif '/commits/' in path and '/pulls?' in path: out = d['pulls']
    elif '/pulls?' in path: out = d.get('prior', [])
    elif '/runs?' in path: out = {'workflow_runs': [d['records'][-1]['run']]}
    elif '/attempts/' in path:
        n = int(path.split('/attempts/')[1].split('/')[0])
        r = d['records'][n - 1]
        out = {'jobs': r['jobs'], 'total_count': len(r['jobs'])} if '/jobs?' in path else r['run']
    elif path.endswith('/logs'):
        jid = path.split('/jobs/')[1].split('/')[0]
        print(next(r['logs'][jid] for r in d['records'] if jid in r['logs'])); sys.exit(0)
    else: raise SystemExit('unexpected read: ' + path)
    print(json.dumps(out))
else: raise SystemExit('unexpected command: ' + str(a))
''')
        # The real script must not fall through to ship (including direct/auto-merge modes).
        (self.main / 'tools/ship.sh').write_text('#!/bin/sh\nexit 79\n')

    def test_one_backbone_suite_red_twice_after_merge_opens_rest_pr_leaving_main_untouched(self):
        self.live_fake()
        result = self.revert(self.bad)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        branch = f'revert-red-{self.bad[:7]}'
        self.assertEqual(git(self.origin, 'rev-parse', 'main'), self.bad)
        self.assertNotIn('bad.txt', git(self.origin, 'ls-tree', '-r', '--name-only', branch).splitlines())
        calls = [json.loads(line) for line in self.evidence.with_suffix('.calls').read_text().splitlines()]
        posts = [c for c in calls if c[:3] == ['api', '-X', 'POST']]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][3], 'repos/GarryOne/jobadabra/pulls')
        self.assertIn('base=main', posts[0])
        self.assertIn(f'head={branch}', posts[0])
        self.assertEqual([c for c in calls if c[0] != 'api'], [], 'never gh pr create')
        self.assertIn('owner merges', self.evidence.with_suffix('.body').read_text())

    def test_an_existing_offer_is_not_pushed_or_opened_again(self):
        self.live_fake()
        self.data['prior'] = [{'html_url': 'https://github.com/GarryOne/jobadabra/pull/98'}]
        result = self.revert(self.bad)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('already offered', result.stdout)
        self.assertEqual(git(self.origin, 'show-ref').count('\n'), 0, 'only main exists')

    def test_empty_offline_evidence_never_falls_back_to_network(self):
        self.live_fake()
        self.data = {}
        result = self.revert('--dry-run', self.bad, '--runs-json', str(self.evidence))
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.evidence.with_suffix('.calls').exists())

    def test_a_two_parent_pr_merge_reverts_against_its_first_parent(self):
        git(self.main, 'checkout', '-qb', 'side', self.bad + '^')
        self.change(self.main, 'side.txt', 'side\n', 'Side')
        git(self.main, 'checkout', '-q', 'main')
        git(self.main, 'merge', '-q', '--no-ff', 'side', '-m', 'Merge PR')
        git(self.main, 'push', '-q', 'origin', 'main')
        self.bad = git(self.main, 'rev-parse', 'HEAD')
        self.data['main']['sha'] = self.bad
        self.data['pulls'][0]['merge_commit_sha'] = self.bad
        for item in self.data['records']:
            item['run']['head_sha'] = self.bad
            item['run']['display_title'] = f'E2E after merge · {self.bad[:7]} · apply'
        self.live_fake()
        result = self.revert(self.bad)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        branch = f'revert-red-{self.bad[:7]}'
        files = git(self.origin, 'ls-tree', '-r', '--name-only', branch).splitlines()
        self.assertIn('bad.txt', files, 'the first parent is retained')
        self.assertNotIn('side.txt', files, 'only the merge is reversed')
        self.assertEqual(git(self.origin, 'rev-parse', 'main'), self.bad)
