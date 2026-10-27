"""A suite step that may fail without failing its job (continue-on-error: a first try the next step decides, or one suite of build.yml's one job) shows its failure:
GitHub draws such a step with a green check (owner, 26 Oct 2026, a screenshot: "'Run quality suite' ended with an error, but step passed green"). So the step writes an
`::error title=...` annotation when its command fails, and a first try says so in its name; the retry is named after the failed first try."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
SUITE = re.compile(r'node suite\.mjs|tools/check\.sh --area|recorded-pages\.test\.mjs|widget-zoo\.mjs|check-fill\.mjs')


def steps(text):
    """-> [(name, block)] for every step of every job (steps are `      - ` items)."""
    out = []
    for block in re.split(r'(?m)^      - ', text)[1:]:
        name = re.search(r'(?m)^(?:name: |        name: )(.+)$', block)
        out.append((name.group(1).strip().strip('"') if name else '', block))
    return out


def quiet_suite_steps():
    found = []
    for path in sorted(WORKFLOWS.glob('*.yml')):
        for name, block in steps(path.read_text(encoding='utf-8')):
            if re.search(r'(?m)^        continue-on-error:', block) and SUITE.search(block):
                found.append((path.name, name, block))
    return found


class FirstTryVisible(unittest.TestCase):
    def test_every_suite_step_that_may_fail_quietly_annotates_its_failure(self):
        found = quiet_suite_steps()
        self.assertGreaterEqual(len(found), 7, f'positive control: e2e, desktop and build.yml suite steps are read ({[f[:2] for f in found]})')
        silent = [f'{file}: {name}' for file, name, block in found if not re.search(r'::(error|warning) title=', block)]
        self.assertEqual(silent, [], 'these suite steps can fail under a green check: write ::error title=... (::warning for a warning-only one) when the command fails')

    def test_a_first_try_and_its_retry_say_what_they_are(self):
        for file in ('e2e.yml', 'desktop.yml'):
            found = steps((WORKFLOWS / file).read_text(encoding='utf-8'))
            names = [name for name, _ in found]
            first = [name for name, block in found if re.search(r'(?m)^        id: suite_run$', block)]
            self.assertTrue(first and all(name.endswith('(first try)') for name in first), f'{file}: {first}')
            self.assertTrue(any(name.startswith('First try failed: ') for name in names), f'{file}: the retry is named after the failed first try')
            self.assertIn('::error title=First try failed::', (WORKFLOWS / file).read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
