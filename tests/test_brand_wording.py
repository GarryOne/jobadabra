"""The product is called Jobadabra in every tracked text file, user-facing or a comment (19 Oct 2026, widened 24 Oct 2026); "Job Pilotto" survives only as a kept compat name.

Fails with file:line when a line says "Job Pilotto" and no KEPT reason covers it. KEPT lines are the names existing installs still use:
the data folder and Keychain item (moved later by a migration of their own), the stored event source, old extension and export names that
must still be recognised, the bundle's file name, external accounts' own names. Rules, skills and specs are scanned too (25 Oct 2026); only the history file docs/rules/why.md is not.
"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOT_SCANNED = re.compile(
    r'(^|/)(node_modules|dist)/|docs/rules/why\.md|desktop/lib/app-identity\.js|'
    r'desktop/test/app-identity\.test\.js|tests/test_brand_wording\.py|\.(png|jpg|jpeg|gif|ico|icns|woff2?|zip|pdf|lock|svg)$|package-lock')
# Kept names: a line is allowed when it matches one of these.
KEPT = re.compile('|'.join([
    r"Application Support|APPDATA|AppData|/ 'Job Pilotto'|\\Job Pilotto|/Job Pilotto\b|Job Pilotto Safe Storage",  # the real data folder, the Keychain item
    r"Job Pilotto\.app|quit app \"Job Pilotto\"|productName|shortcutName|\"title\": \"Job Pilotto \$\{version\}\"",  # the bundle's file name (the updater swaps it)
    r"Job Pilotto (QA|Brain|2\b|\(<old workspace>\)|Backups|backup|\(live test\)|Live[ -]Test|– Live Test|Live-Test)|- mac -|archived 28 Sep",  # owner-only names, old Notion page names
    r"'Job Pilotto app'|\"Job Pilotto app\"|Job Pilotto app'",                    # the event source stored in users' rows
    r"manifest\??\.app|app: 'Job Pilotto'|\[NAME, 'Job Pilotto'\]|!== 'Job Pilotto'|=== 'Job Pilotto'|missing: \['Job Pilotto'\]|LEGACY_NAME",  # old installs recognised
    r"^\s*name: Job Pilotto\s*$|# Job Pilotto'|GitHub App|job-pilotto|before the rename|extension installed and the person",
    r"^\s*\"why\": |\(Job Pilotto\|Jobadabra\)|\(\?:Jobadabra\|Job Pilotto\)|\.app, \'Job Pilotto\'\)|path\.join\(real, \'Job Pilotto\'|of \['Jobadabra', 'Job Pilotto'\]|before it were stored as|# Job Pilotto — (retired|a check)|exports made before say \"Job Pilotto\"|an old \"Job Pilotto\" export|Job Pilotto (Tests|Sentry|Sign-in|Self-heal|E2E|2\b)|missing Job Pilotto|connection \"Job Pilotto\"|integrations → Job Pilotto",  # external accounts' own names
]))


class BrandWording(unittest.TestCase):
    def test_tracked_files_say_jobadabra(self):
        files = subprocess.run(['git', '-C', str(ROOT), 'ls-files'], capture_output=True, text=True, check=True).stdout.split('\n')
        bad = []
        for name in files:
            if not name or NOT_SCANNED.search(name):
                continue
            try:
                lines = (ROOT / name).read_text().splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            bad += [f'{name}:{n}: {line.strip()[:110]}' for n, line in enumerate(lines, 1) if 'Job Pilotto' in line and not KEPT.search(line)]
        self.assertEqual(bad, [], 'say "Jobadabra" (or add the kept compat name to KEPT with its reason):\n' + '\n'.join(bad[:40]))


if __name__ == '__main__':
    unittest.main()
