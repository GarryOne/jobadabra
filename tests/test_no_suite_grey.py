"""A suite job is never grey: its one try is red or green, and no reader or workflow knows a "grey" suite verdict.

Why (31 Oct 2026, owner: "Is this expected? Error but step passed green ?"; a suite past its budget is our bug, so RED, confirmed by the owner through mac-07):
before, a retry step wrote the annotation "Grey: the runner, not the app" and the job ended green, and the beta gate, the red-main gate, the PR verdict, the
alert and the revert proof each read that title. Since the single-try change nothing writes it, so every reader of it was dead code that would silently
make a failed suite look healthy if a writer came back. Grey stays only for problems outside our code that the PR verdict reads from logs and marks
(runner never acquired, install download, AI credit: tools/pr_health_greys.py). The retry guard is tests/test_e2e_single_try.py.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github' / 'workflows'
# The annotation title and the names of the helpers that read it; a reader coming back is how a failed suite would turn green again.
GREY_PROOF = re.compile(r"Grey: the runner|title=Grey\b|\bis_grey\b|\bisGrey\b|\bGREY_TITLE\b|runner-grey|beta[_-]grey[_-]rerun|\bgrey-record\b|beta-held|outputs\.held\b")
SOURCES = [*ROOT.glob('tools/*.py'), *ROOT.glob('tools/*.sh'), *ROOT.glob('tools/*.mjs'), *ROOT.glob('desktop/e2e/*.mjs'), *ROOT.glob('desktop/e2e/lib/*.mjs'),
           *ROOT.glob('.github/workflows/*.yml')]


def mentions(paths):
    return [f'{path.relative_to(ROOT)}:{n}: {line.strip()[:100]}' for path in sorted(paths)
            for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1) if GREY_PROOF.search(line)]


class NoSuiteGrey(unittest.TestCase):
    def test_positive_control_the_sources_are_read_and_the_pattern_matches(self):
        self.assertGreater(len(SOURCES), 50)
        for sample in ('::warning title=Grey: the runner, not the app::x', 'is_grey(notes)', 'import {isGrey}', "'runner-grey'", 'steps.backbone_gate.outputs.held'):
            self.assertRegex(sample, GREY_PROOF)

    def test_no_workflow_tool_or_reader_knows_a_grey_suite_verdict(self):
        # Why this test file names the words itself: it is not in SOURCES.
        self.assertEqual(mentions(SOURCES), [])

    def test_the_grey_beta_rerun_is_gone(self):
        for gone in ('.github/workflows/beta-grey-rerun.yml', 'tools/beta_grey_rerun.py', 'tests/test_beta_grey_rerun.py', 'desktop/e2e/lib/grey-record.mjs'):
            self.assertFalse((ROOT / gone).exists(), gone)


if __name__ == '__main__':
    unittest.main()
