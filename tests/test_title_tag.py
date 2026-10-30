"""Guard for tools/title-tag.mjs (puts a PR's "[xx] " tag back when a title edit drops it): runs the node cases in tests/title_tag_cases.mjs and checks the workflow."""
import importlib.util
import json
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

    def test_the_gate_and_the_restorer_agree_on_what_a_tag_is(self):
        # Gitar on #2577: the tag rule lived twice. Every title goes through both: the gate (no old tag) calls it a gap exactly when the restorer would put a tag back.
        spec = importlib.util.spec_from_file_location('pr_body_check', ROOT / 'tools/pr-body-check.py')
        check = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(check)
        titles = ['[ac] Words', '[ac]Words', '[ac] ', '[] Words', 'Words', '[27] 1/2 Words', ' [ac] Words', '[a] [b] Words', '[ac]  Words']
        script = "import {restoredTitle} from './tools/title-tag.mjs'; for (const t of JSON.parse(process.argv[1])) console.log(restoredTitle('[xx] Old', t) === null ? 'keep' : 'restore');"
        out = subprocess.run(['node', '--input-type=module', '-e', script, json.dumps(titles)], capture_output=True, text=True, cwd=ROOT, check=True).stdout.split()
        for title, verdict in zip(titles, out):
            self.assertEqual(check.title_gap(title) is None, verdict == 'keep', f'gate and restorer disagree on {title!r}')

    def test_a_dropped_tag_is_left_to_the_restorer_not_the_gate(self):
        check = importlib.util.module_from_spec(importlib.util.spec_from_file_location('pr_body_check', ROOT / 'tools/pr-body-check.py'))
        check.__spec__.loader.exec_module(check)
        self.assertIsNone(check.title_gap('Words', '[ac] Old words'))
        self.assertIsNotNone(check.title_gap('Words', 'Old words'))
        self.assertIsNotNone(check.title_gap('Words'))
        flow = (ROOT / '.github/workflows/pr-gate.yml').read_text()
        self.assertIn('OLD_TITLE: ${{ github.event.changes.title.from }}', flow)


if __name__ == '__main__':
    unittest.main()
