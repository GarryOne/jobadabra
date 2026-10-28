"""Registry checks that CI runs but the fast checks of a pull-request push did not (18 Oct 2026): a pure, seconds-long run of the tests that pin a list to the files it must cover.
Owns the table below; tools/pre-push-check.sh calls it on every push, tests/test_registry_check.py guards it. A new registry test that is pure and fast goes in CHECKS."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent

# (unittest id, where the list lives and what to add when it fails)
CHECKS = [
    ('tests.test_lock_test_scope.LockTestScope.test_every_tools_file_a_lock_test_names_is_a_lock_path',
     'add the tools/ file named above to LOCK_PATHS in tools/py-shards.py', 'tools/py-shards.py', r'^LOCK_PATHS\b'),
    ('tests.test_red_main.RedMainTest.test_every_workflow_is_classified_and_the_counted_ones_are_the_scripts_list',
     'add the workflow named above to CLASSIFIED in tests/test_red_main.py (counted, or ignored with the reason)', 'tests/test_red_main.py', r'^CLASSIFIED\b'),
]


def line_of(path, pattern):
    try:
        for number, line in enumerate((ROOT / path).read_text(encoding='utf-8').splitlines(), 1):
            if re.search(pattern, line):
                return number
    except OSError:
        pass
    return 1


def main():
    failed = 0
    for test_id, hint, path, pattern in CHECKS:
        run = subprocess.run([sys.executable, '-m', 'unittest', test_id], cwd=ROOT, capture_output=True, text=True, timeout=120)
        if run.returncode == 0:
            continue
        failed += 1
        print(f'registry check failed: {test_id.rsplit(".", 1)[-1]}\n{run.stderr.strip()}\n=> {hint} ({path}:{line_of(path, pattern)})\n')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
