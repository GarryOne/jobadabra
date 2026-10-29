"""Exercise the architecture ratchet on temporary commits without installs, network or live app data."""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('arch_check', ROOT / 'tools/arch-check.py')
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)


def violation(rule='no-circular', source='desktop/a.js', target='desktop/b.js'):
    """One dependency-cruiser summary violation (Windows paths are allowed)."""
    return {'from': source, 'to': target, 'rule': {'name': rule, 'severity': 'error'}}


class RepoTest(unittest.TestCase):
    """All git mutations stay in a disposable repository; no git config is written."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.write('desktop/a.js', 'export const a = 1;\n')
        self.write('extension/a.js', 'export const x = 1;\n')
        shutil.copyfile(ROOT / '.dependency-cruiser.cjs', self.root / '.dependency-cruiser.cjs')
        self.commit('base')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')

    def git(self, *args):
        env = {**os.environ, 'GIT_AUTHOR_NAME': 'Test', 'GIT_AUTHOR_EMAIL': 'test@example.invalid',
               'GIT_COMMITTER_NAME': 'Test', 'GIT_COMMITTER_EMAIL': 'test@example.invalid',
               'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull}
        return subprocess.run(['git', '-c', 'core.hooksPath=', *args], cwd=self.root,
                              env=env, capture_output=True, text=True, check=True).stdout

    def write(self, name, text):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding='utf-8')

    def commit(self, message):
        self.git('add', '.')
        self.git('commit', '-qm', message)

    def run_gate(self, argv=(), findings=None, command=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            with patch.object(tool, 'cruiser_command', return_value=command or ['fake-cruiser']):
                if findings is None:
                    code = tool.main(list(argv), root=self.root)
                else:
                    with patch.object(tool, 'cruise', side_effect=findings):
                        code = tool.main(list(argv), root=self.root)
        return code, out.getvalue(), err.getvalue()


class RatchetTest(RepoTest):
    def test_clean_change_passes_and_report_has_stable_zero_keys(self):
        self.write('desktop/a.js', 'export const a = 2;\n')
        self.commit('clean')
        code, out, err = self.run_gate(['--report'], [[], []])
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out), {rule: {'main': 0, 'head': 0} for rule in tool.FIXES})

    def test_added_cycle_fails_and_names_both_files(self):
        code, _, err = self.run_gate(findings=[[], [violation()]])
        self.assertEqual(code, 1)
        self.assertIn('desktop/a.js -> desktop/b.js  (no-circular)', err)
        self.assertIn('break the cycle', err)

    def test_old_cycle_does_not_block_an_unrelated_change(self):
        self.write('desktop/unrelated.js', 'export const x = 3;\n')
        self.commit('unrelated')
        code, _, err = self.run_gate(findings=[[violation()], [violation()]])
        self.assertEqual(code, 0, err)

    def test_only_growing_rules_block_and_only_new_findings_are_printed(self):
        old = violation()
        new = violation('renderer-no-node-layer', r'desktop\renderer\x.js', r'desktop\lib\x.js')
        code, out, err = self.run_gate(['--report'], [[old], [old, new]])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)['renderer-no-node-layer'], {'main': 0, 'head': 1})
        self.assertIn('desktop/renderer/x.js -> desktop/lib/x.js', err)
        self.assertNotIn('desktop/a.js ->', err)

    def test_replacing_a_violation_without_increasing_count_passes(self):
        code, _, err = self.run_gate(findings=[[violation()], [violation(source='desktop/new.js')]])
        self.assertEqual(code, 0, err)

    def test_snapshot_uses_commits_not_working_tree_and_excludes_nonproduction(self):
        self.write('desktop/b.js', "import './a.js';\n")
        for folder in ('test', 'e2e', 'shared', 'vendor', 'node_modules', 'scripts', 'demo'):
            self.write(f'desktop/{folder}/excluded.js', 'invalid javascript')
        self.write('desktop/lib/x.test.js', 'invalid javascript')
        self.commit('new module')
        self.write('desktop/b.js', 'uncommitted')
        self.write('desktop/untracked.js', 'untracked')
        dest = self.root / 'snapshot'
        tool.snapshot(self.root, 'HEAD', dest)
        self.assertEqual((dest / 'desktop/b.js').read_text(), "import './a.js';\n")
        self.assertEqual(sorted(p.relative_to(dest).as_posix() for p in dest.rglob('*.js')),
                         ['desktop/a.js', 'desktop/b.js', 'extension/a.js'])
        base = self.root / 'baseline'
        tool.snapshot(self.root, 'origin/main', base)
        self.assertFalse((base / 'desktop/b.js').exists())

    def test_offline_without_tool_is_explicit_and_checks_nothing(self):
        with patch.object(tool, 'cruiser_command', return_value=None):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = tool.main(['--offline', '--report'], root=self.root)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue()), {})
        self.assertIn('offline', err.getvalue())
        self.assertIn('nothing checked', err.getvalue())

    def test_tool_failure_does_not_masquerade_as_a_clean_graph(self):
        with patch.object(tool, 'cruise', side_effect=RuntimeError('bad parser')):
            code, _, err = self.run_gate()
        self.assertEqual(code, 2)
        self.assertIn('bad parser', err)

    def test_hook_runs_architecture_immediately_after_ruff_before_pr_exit(self):
        hook = (ROOT / 'tools/pre-push-check.sh').read_text(encoding='utf-8')
        start = hook.index('python3 tools/clean-code-py.py --base origin/main')
        arch = hook.index('python3 tools/arch-check.py --base origin/main')
        self.assertLess(start, arch)
        self.assertLess(arch, hook.index('timed "spec proof"'))
        self.assertLess(arch, hook.index('case "$command" in *SHIP_PR=1*|*CI_GATES=1*)'))


class ToolTest(unittest.TestCase):
    def test_offline_discovery_never_installs(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(os.environ, {'JOBADABRA_CACHE': folder}), patch('shutil.which', return_value=None):
                with patch.object(tool.subprocess, 'run') as run:
                    self.assertIsNone(tool.cruiser_command(offline=True))
                    run.assert_not_called()

    def test_bootstrap_installs_only_inside_versioned_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            def installed(*args, **kwargs):
                home = Path(folder).resolve() / f'dependency-cruiser-{tool.DEPENDENCY_CRUISER_VERSION}'
                package = home / 'node_modules/dependency-cruiser'
                package.mkdir(parents=True)
                (package / 'package.json').write_text(json.dumps({'version': tool.DEPENDENCY_CRUISER_VERSION}))
                (package / 'bin').mkdir()
                (package / 'bin/dependency-cruise.mjs').write_text('// fixture')
                return subprocess.CompletedProcess(args[0], 0, '', '')
            with patch.dict(os.environ, {'JOBADABRA_CACHE': folder}), patch('shutil.which', side_effect=lambda n: n if n in ('node', 'npm') else None):
                with patch.object(tool.subprocess, 'run', side_effect=installed) as run:
                    command = tool.cruiser_command()
            argv = run.call_args.args[0]
            home = Path(folder).resolve() / f'dependency-cruiser-{tool.DEPENDENCY_CRUISER_VERSION}'
            self.assertEqual(Path(run.call_args.kwargs['cwd']), home)
            self.assertIn(f'dependency-cruiser@{tool.DEPENDENCY_CRUISER_VERSION}', argv)
            self.assertIn('--ignore-scripts', argv)
            self.assertEqual(command[0], 'node')
            self.assertTrue(Path(command[1]).is_relative_to(home))

    def test_cruiser_reads_findings_on_exit_one_and_normalizes_paths(self):
        payload = {'summary': {'violations': [violation(source=r'desktop\a.js', target=r'desktop\b.js')]}}
        result = subprocess.CompletedProcess([], 1, json.dumps(payload), '')
        with patch.object(tool.subprocess, 'run', return_value=result) as run:
            found = tool.cruise(['node', 'pinned-cli'], ROOT, ROOT / '.dependency-cruiser.cjs')
        self.assertEqual(found[0]['from'], 'desktop/a.js')
        self.assertEqual(found[0]['to'], 'desktop/b.js')
        self.assertEqual(run.call_args.kwargs['cwd'], ROOT)
        self.assertEqual(run.call_args.args[0][:2], ['node', 'pinned-cli'])
        self.assertIn(str(ROOT / '.dependency-cruiser.cjs'), run.call_args.args[0])

    def test_invalid_json_and_process_errors_are_failures(self):
        for result in (subprocess.CompletedProcess([], 1, 'invalid', 'parse failed'),
                       subprocess.CompletedProcess([], 2, '{}', 'bad config')):
            with self.subTest(result=result), patch.object(tool.subprocess, 'run', return_value=result):
                with self.assertRaises(RuntimeError):
                    tool.cruise(['fake'], ROOT, ROOT / '.dependency-cruiser.cjs')


class CruiserIntegrationTest(RepoTest):
    """Real dependency-cruiser controls run only when the pinned tool is already present."""

    def setUp(self):
        super().setUp()
        self.command = tool.cruiser_command(offline=True)
        if self.command is None:
            self.skipTest('pinned dependency-cruiser unavailable; no installs or network in tests')

    def actual(self):
        return self.run_gate(command=self.command)

    def plant_cycle(self):
        self.write('desktop/a.js', "import './b.js';\nexport const a = 1;\n")
        self.write('desktop/b.js', "import './a.js';\nexport const b = 1;\n")
        self.commit('cycle')

    def assert_cycle_blocked(self):
        code, _, err = self.actual()
        self.assertEqual(code, 1, err)
        self.assertIn('desktop/a.js', err)
        self.assertIn('desktop/b.js', err)
        self.assertIn('no-circular', err)

    def test_planted_cycle_blocks(self):
        self.plant_cycle()
        self.assert_cycle_blocked()

    def test_positive_control_cycle_assertion_fails_with_rule_off(self):
        self.plant_cycle()
        config = self.root / '.dependency-cruiser.cjs'
        config.write_text(config.read_text().replace("{name: 'no-circular', severity: 'error', from: {}, to: {circular: true}},", ''))
        # The same planted-cycle assertion must turn red when its rule is removed.
        with self.assertRaises(AssertionError):
            self.assert_cycle_blocked()
        self.assertEqual(self.actual()[0], 0)

    def test_forbidden_imports_block(self):
        self.write('desktop/renderer/a.js', "import '../lib/a.js';\n")
        self.write('desktop/lib/a.js', "import '../renderer/a.js';\n")
        self.write('extension/a.js', "import '../desktop/main.js';\n")
        self.write('desktop/main.js', 'export const main = 1;\n')
        self.commit('wrong directions')
        code, _, err = self.actual()
        self.assertEqual(code, 1, err)
        for rule in ('renderer-no-node-layer', 'extension-no-desktop'):
            self.assertIn(rule, err)
        self.assertIn('extension/a.js -> desktop/main.js', err)

    def test_untouched_old_cycle_passes(self):
        self.plant_cycle()
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.write('desktop/new.js', 'export const clean = 1;\n')
        self.commit('unrelated')
        code, _, err = self.actual()
        self.assertEqual(code, 0, err)

    def test_clean_change_passes(self):
        self.write('desktop/b.js', "import './a.js';\n")
        self.commit('clean import')
        code, _, err = self.actual()
        self.assertEqual(code, 0, err)


if __name__ == '__main__':
    unittest.main()
