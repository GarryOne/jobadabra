"""A suite step that may fail without failing its job (continue-on-error: one suite of build.yml's one job, which a later gate turns red) shows its failure:
GitHub draws such a step with a green check (owner, 26 Oct 2026, a screenshot: "'Run quality suite' ended with an error, but step passed green"). So the step writes an
`::error title=...` annotation when its command fails. An e2e suite step has no continue-on-error at all since 31 Oct 2026 (tests/test_e2e_single_try.py).
Job: report health"""
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


def with_action_body(block):
    """A step that calls a repo composite action (`uses: ./.github/actions/<x>`) runs that action's commands: read them as the step's own (owner, 1 Nov 2026: the desktop unit step moved into .github/actions/unit-tests)."""
    called = re.search(r'(?m)^\s+uses: \./\.github/actions/([\w-]+)\s*$', block)
    action = WORKFLOWS.parent / 'actions' / called.group(1) / 'action.yml' if called else None
    return block + '\n' + action.read_text(encoding='utf-8') if action and action.exists() else block


def quiet_suite_steps():
    found = []
    for path in sorted(WORKFLOWS.glob('*.yml')):
        for name, block in steps(path.read_text(encoding='utf-8')):
            block = with_action_body(block)
            if re.search(r'(?m)^        continue-on-error:', block) and SUITE.search(block):
                found.append((path.name, name, block))
    return found


class FirstTryVisible(unittest.TestCase):
    def test_every_suite_step_that_may_fail_quietly_annotates_its_failure(self):
        found = quiet_suite_steps()
        self.assertGreaterEqual(len(found), 5, f'positive control: build.yml suite steps are read ({[f[:2] for f in found]})')
        silent = [f'{file}: {name}' for file, name, block in found if not re.search(r'::(error|warning) title=', block)]
        self.assertEqual(silent, [], 'these suite steps can fail under a green check: write ::error title=... (::warning for a warning-only one) when the command fails')


if __name__ == '__main__':
    unittest.main()
