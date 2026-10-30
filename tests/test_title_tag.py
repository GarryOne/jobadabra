"""Guard for tools/title-tag.mjs (puts a PR's "[xx] " tag back when a title edit drops it): runs the node cases in tests/title_tag_cases.mjs and checks the workflow."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class TitleTagTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node missing')
    def test_node_cases_pass(self):
        done = subprocess.run(['node', '--test', str(ROOT / 'tests/title_tag_cases.mjs')], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_runs_on_a_title_edit_and_never_runs_a_prs_code(self):
        # Owner, 30 Oct 2026: the tag guardrail is "auto-restore" (#2549 lost its [ac] to a hand edit). pull_request_target runs with write access, so it must use main's script.
        flow = (ROOT / '.github/workflows/title-tag.yml').read_text()
        on = flow.split('\non:\n', 1)[1].split('\n\n', 1)[0]
        self.assertIn('pull_request_target:\n    types: [edited]', on)
        self.assertIn("if: github.event.changes.title", flow, 'only a title edit (a body edit has no changes.title)')
        self.assertIn('ref: ${{ github.event.repository.default_branch }}', flow, "main's copy of the script, never the PR's")
        self.assertIn('OLD_TITLE: ${{ github.event.changes.title.from }}', flow, 'the title goes in through env, never interpolated into the shell')
        self.assertNotIn('run: node tools/title-tag.mjs ${{', flow)


if __name__ == '__main__':
    unittest.main()
