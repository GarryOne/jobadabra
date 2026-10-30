"""Guard for tools/title-tag.mjs (puts a PR's "[xx] " tag back when a title edit drops it): runs the node cases in tests/title_tag_cases.mjs and checks pr-gate's step."""
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

    def test_pr_gate_repairs_then_judges_in_one_run(self):
        # Owner, 30 Oct 2026: the tag guardrail is "auto-restore" (#2549 lost its [ac] to a hand edit). Gitar on #2577: a repair made by another workflow with GITHUB_TOKEN starts no new
        # gate run and its own check never reaches "All checks passed", so the gate's step repairs and judges in one run (a failed repair is that step's red).
        flow = (ROOT / '.github/workflows/pr-gate.yml').read_text()
        step = flow.split('- name: PR description laid out', 1)[1].split('\n      # ', 1)[0]
        self.assertIn('OLD_TITLE: ${{ github.event.changes.title.from }}', step)
        self.assertIn('PR_TITLE="$(node tools/title-tag.mjs)"', step, 'the title judged is the one the repair prints')
        self.assertLess(step.index('title-tag.mjs'), step.index('pr-body-check.py'), 'repair first, then judge')
        self.assertIn('pull-requests: write', flow)
        self.assertFalse((ROOT / '.github/workflows/title-tag.yml').exists(), 'a second workflow would be a second owner of the title verdict')

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


if __name__ == '__main__':
    unittest.main()
