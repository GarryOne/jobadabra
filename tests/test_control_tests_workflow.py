"""The widget zoo (control tests) runs on main's every push inside build.yml, and by hand; never on a pull request (owner, 26 Oct 2026)."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'control-tests.yml'


class WidgetZooWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()

    def test_main_runs_it_and_a_pull_request_never_does(self):
        # Since #883 (15 Oct 2026) main runs the zoo as a step of build.yml's one Linux job. Off PRs since 26 Oct 2026 (owner: "no control tests"; it measures,
        # it is not required, and PRs waited on runners: ~20 jobs at once, 28 queued).
        on = self.text[self.text.index('\non:'):self.text.index('\nconcurrency:')]
        self.assertNotIn('\n  pull_request', on)
        self.assertNotIn('\n  push:', on, 'main runs it inside CI · Tests, not as a push run of its own')
        self.assertIn('\n  workflow_dispatch:', on)
        self.assertIn('widget-zoo.mjs', (ROOT / '.github' / 'workflows' / 'build.yml').read_text(), 'main runs the zoo on every push, in build.yml')

    def test_no_shared_pick(self):
        self.assertNotIn('ci-needed', self.text)
        self.assertNotRegex(self.text, r'git diff --name-only', 'no second list of the zoo\'s paths')


if __name__ == '__main__':
    unittest.main()
