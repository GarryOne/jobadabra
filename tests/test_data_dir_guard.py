"""Every engine entry point refuses the Desktop App's data folder unless the app, an explicit folder or an explicit override says otherwise."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY = sorted(p.relative_to(ROOT).as_posix()[:-3].replace('/', '.') for p in (ROOT / 'src').rglob('*.py')
               if re.search(r"__name__ == .__main__.", p.read_text(encoding='utf-8')) or p.name == '__main__.py')


class DataDirGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = Path(cls.tmp) / 'fake app'
        for sub in ('data', 'config'):
            (cls.app / sub).mkdir(parents=True)
        (cls.app / 'settings.json').write_text(json.dumps({'setupDone': True, 'notionIds': {'NOTION_APPLICATIONS_DB': 'fake'}}))

    def run_py(self, code, **extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_', 'NOTION_'))}
        env.update({'JOBADABRA_APP_DIR': str(self.app), 'PYTHONPATH': str(ROOT)}, **extra)
        return subprocess.run([sys.executable, '-c', code], cwd=self.tmp, env=env, capture_output=True, text=True)

    def test_entry_points_are_found(self):
        self.assertIn('src.daily', ENTRY)
        self.assertIn('src.ai.apply_run', ENTRY)

    def test_every_entry_point_is_refused_without_a_folder_or_override(self):
        for module in ENTRY:
            with self.subTest(module=module):
                done = self.run_py(f'import importlib, sys\nmodule = importlib.import_module({module!r})\nsys.exit(7 if "src.paths" in sys.modules else 0)')
                if done.returncode == 0:
                    continue  # never reads src.paths: touches no folder
                self.assertNotEqual(done.returncode, 7, f'{module} imported src.paths without the guard refusing')
                self.assertIn('JOBADABRA_DATA_DIR', done.stderr)

    def test_the_way_out_cases(self):
        own = Path(self.tmp) / 'own'
        probe = 'from src import paths; print(paths.DATA)'
        cases = [
            ('explicit folders', {'JOBADABRA_DATA_DIR': str(own / 'd'), 'JOBADABRA_CONFIG_DIR': str(own / 'c')}, str(own / 'd')),
            ('FOLLOW_APP=1 (owner\'s own run)', {'JOBADABRA_FOLLOW_APP': '1'}, str(self.app / 'data')),
            ('FOLLOW_APP=0 (repo example data)', {'JOBADABRA_FOLLOW_APP': '0'}, str(ROOT / 'data')),
            ('the app itself (NO_DOTENV + folders)', {'JOBADABRA_NO_DOTENV': '1', 'JOBADABRA_DATA_DIR': str(own / 'a'), 'JOBADABRA_CONFIG_DIR': str(own / 'b')}, str(own / 'a')),
            ('CI: no app on the computer', {'JOBADABRA_APP_DIR': str(Path(self.tmp) / 'no app here')}, str(ROOT / 'data')),
        ]
        for name, extra, want in cases:
            with self.subTest(name):
                done = self.run_py(probe, **extra)
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual(done.stdout.strip().replace('\\', '/'), want.replace('\\', '/'))

    def test_refusal_names_the_variable_and_opens_nothing(self):
        done = self.run_py('from src import paths')
        self.assertNotEqual(done.returncode, 0)
        self.assertIn('JOBADABRA_DATA_DIR', done.stderr)
        self.assertEqual(sorted(p.name for p in self.app.iterdir()), ['config', 'data', 'settings.json'])


if __name__ == '__main__':
    unittest.main()
