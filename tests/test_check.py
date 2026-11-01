"""The shared checker selects compatible runtimes, preserves failure status and uses the same suite commands as CI."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('project_check', Path(__file__).resolve().parents[1] / 'tools/check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class CheckTests(unittest.TestCase):
    def test_node_versions(self):
        for version in ['v12.18.3', 'v20.19.0', 'v22.12.0', 'v23.0.0']:
            self.assertFalse(check.node_supported(version))
        for version in ['v22.13.0', 'v22.23.1', 'v24.0.0']:
            self.assertTrue(check.node_supported(version))

    def test_fallback_from_stale_node(self):
        with mock.patch.object(check.shutil, 'which', return_value='/old/node'), mock.patch.object(check.subprocess, 'check_output', side_effect=['v22.23.1']):
            node, version = check.find_node({'JOBADABRA_CHECK_NODE': '/new/node', 'NVM_DIR': '/nonexistent'})
            self.assertEqual(node, '/new/node')
            self.assertEqual(version, 'v22.23.1')
        with mock.patch.object(check.shutil, 'which', return_value='/old/node'), mock.patch.object(check.subprocess, 'check_output', return_value='v12.0.0'):
            with self.assertRaisesRegex(RuntimeError, 'Node 22'):
                check.find_node({'NVM_DIR': '/nonexistent'})

    def test_area_and_fast_commands(self):
        full = check.commands('desktop', False, 'node', 'npm')
        self.assertEqual(full[0][1], ['npm', 'test'])
        fast = check.commands('desktop', True, 'node', 'npm')
        self.assertEqual(fast[0][1], ['node', 'scripts/stage.mjs'])
        self.assertIn('test/session-contracts.test.js', fast[-1][1])
        self.assertIn('test/app-scenarios.test.js', fast[-1][1])
        # 9 Oct 2026: the full Python suite runs sharded (same tests, tools/py-shards.py); the old single process stays behind an env switch.
        self.assertEqual(check.commands('python', False, None, None)[0][1][1:], ['tools/py-shards.py'])
        with mock.patch.dict(check.os.environ, {'JOBADABRA_PY_SERIAL': '1'}):
            self.assertEqual(check.commands('python', False, None, None)[0][1][1:4], ['-m', 'unittest', 'discover'])
        # A local push with a picked subset runs just those files; an empty pick runs no tests (desktop still lints).
        self.assertEqual(check.commands('python', False, None, None, ['test_a'])[0][1][1:], ['tools/py-shards.py', 'test_a'])
        self.assertEqual(check.commands('python', False, None, None, []), [])
        picked = check.commands('desktop', False, 'node', 'npm', ['test/a.test.js'])
        self.assertEqual([c[1][:3] for c in picked], [['node', 'scripts/stage.mjs'], ['npm', 'run', 'lint'], ['node', '--test', 'test/a.test.js']])
        self.assertEqual([c[1][1] for c in check.commands('desktop', False, 'node', 'npm', [])], ['scripts/stage.mjs', 'run'])

    def test_failure_propagates_and_external_services_are_disabled(self):
        with mock.patch.object(check.subprocess, 'run', return_value=mock.Mock(returncode=3)) as run:
            self.assertEqual(check.main(['--area', 'python']), 1)
            self.assertEqual(run.call_args.kwargs['env']['JOBADABRA_DISABLE'], 'mail,notion,telegram,google_jobs')
            self.assertEqual(run.call_args.kwargs['env']['npm_config_legacy_peer_deps'], 'false')

    def test_missing_dependencies_are_actionable(self):
        with mock.patch.object(check, 'find_node', return_value=('/node', 'v22.23.1')), mock.patch.object(check.shutil, 'which', return_value='/npm'), mock.patch.object(check.Path, 'is_dir', return_value=False):
            self.assertEqual(check.main(['--area', 'desktop']), 2)

    def test_the_worker_area_checks_the_modules_of_its_folder(self):
        """Why (1 Nov 2026, #2882 red): the `worker` suite's folder is app-core/; check.py asked for worker/node_modules, which CI never has (a worktree's old link hid it locally)."""
        self.assertEqual(check.AREA_DIR['worker'], 'app-core')
        self.assertTrue((check.ROOT / 'app-core' / 'package.json').is_file())
        self.assertFalse((check.ROOT / 'worker' / 'node_modules').exists() and not (check.ROOT / 'app-core' / 'node_modules').exists())
        seen = []
        def only_app_core(path):
            seen.append(path.as_posix())
            return path.parent.name == 'app-core' and path.name == 'node_modules'
        with mock.patch.object(check, 'find_node', return_value=('/node', 'v22.23.1')), mock.patch.object(check.shutil, 'which', return_value='/npm'), \
                mock.patch.object(check.Path, 'is_dir', only_app_core), mock.patch.object(check.subprocess, 'run', return_value=mock.Mock(returncode=0)), \
                mock.patch('builtins.print'):
            check.main(['--area', 'worker'])
        self.assertTrue(any(p.endswith('app-core/node_modules') for p in seen), seen)
        self.assertFalse(any(p.endswith('worker/node_modules') for p in seen), seen)

