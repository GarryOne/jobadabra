"""tools/ship.sh writes a shared git setting only when it differs (27 Oct 2026): two ships started together both rewrote .git/config, and one
lost the lock ("could not lock config file .git/config: File exists") and ended FAILED before its rebase, twice in one hour."""
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHIP = (ROOT / 'tools' / 'ship.sh').read_text()


@unittest.skipUnless(shutil.which('bash') and shutil.which('git'), 'needs bash and git')
class ConfigOnceTest(unittest.TestCase):
    def run_config_once(self, key, value, lock):
        helper = re.search(r'^config_once\(\) \{.*\}$', SHIP, re.M).group(0)
        with tempfile.TemporaryDirectory() as repo:
            subprocess.run(['git', 'init', '-q', repo], check=True)
            subprocess.run(['git', '-C', repo, 'config', 'core.hooksPath', 'tools/githooks'], check=True)
            if lock:
                (Path(repo) / '.git' / 'config.lock').write_text('another ship holds it')
            return subprocess.run(['bash', '-c', f'{helper}\nconfig_once "$1" "$2"', 'x', key, value], cwd=repo, capture_output=True, text=True)

    def test_a_setting_already_right_is_not_written_so_a_held_lock_does_not_fail_the_ship(self):
        self.assertEqual(self.run_config_once('core.hooksPath', 'tools/githooks', lock=True).returncode, 0)

    def test_a_setting_that_differs_is_still_written(self):
        self.assertEqual(self.run_config_once('merge.ladder-baseline.driver', 'node x.mjs', lock=False).returncode, 0)
        self.assertNotEqual(self.run_config_once('merge.ladder-baseline.driver', 'node x.mjs', lock=True).returncode, 0, 'the helper really writes (the lock proves it)')

    def test_every_git_config_write_in_ship_goes_through_the_helper(self):
        writes = [line for line in SHIP.splitlines() if re.search(r'\bgit config (?!--get)\S', line) and not line.lstrip().startswith(('#', 'config_once()'))]
        self.assertEqual(writes, [])


if __name__ == '__main__':
    unittest.main()
