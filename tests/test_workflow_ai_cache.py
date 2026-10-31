"""The e2e AI-answer cache keeps only answers from a green job (26 Oct 2026: main's mailreading went red on one bad Free AI draw; the cache saved it (`always()`),
and every later run replayed it, so a rerun could never tell flaky from real). A suite has no second try that replays them (31 Oct 2026, owner)."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github/workflows'
FILES = ('e2e.yml', 'desktop.yml', 'e2e-windows.yml')


def steps(text):
    return re.split(r'(?m)^      - ', text)[1:]


class AiAnswerCacheTests(unittest.TestCase):
    def test_every_ai_answers_save_waits_for_a_green_job(self):
        saved = 0
        for name in FILES:
            for step in steps((WORKFLOWS / name).read_text()):
                if 'actions/cache/save' in step and 'ai-answers-' in step:
                    saved += 1
                    with self.subTest(file=name):
                        self.assertIn('success()', step)
                        self.assertNotIn('always()', step)
        self.assertGreaterEqual(saved, 4, 'a save step moved: update this test')

    def test_retired_mail_suite_has_no_cache_key_workaround(self):
        for name in FILES:
            text = (WORKFLOWS / name).read_text()
            with self.subTest(file=name):
                self.assertNotIn("matrix.key == 'mailreading'", text)
                self.assertNotIn('ai-answers-v2-', text)

    # Why (31 Oct 2026, owner): a job has one try; nothing replays a stored table on a second run of the same commit any more.
    def test_no_step_replays_the_answers_for_a_second_try(self):
        for name in FILES:
            text = (WORKFLOWS / name).read_text()
            self.assertNotIn('E2E_RERUN=1', text, name)
            self.assertEqual([step for step in steps(text) if 'if again ' in step], [], name)

    # Main cannot read a PR's cache (27 Oct 2026: #2180 green on its PR with 0 misses, main red after 8 live questions): the PR hands its answers over.
    def test_a_green_pr_job_hands_its_answers_to_main(self):
        uploads = [step for step in steps((WORKFLOWS / 'e2e.yml').read_text()) if 'upload-artifact' in step and 'ai-answers-' in step]
        self.assertEqual(len(uploads), 1, 'one upload of the AI answers, from a PR run')
        step = uploads[0]
        for part in ('success()', "inputs.pr_suites != ''", "inputs.after_merge == ''", 'include-hidden-files: true', 'path: desktop/e2e/.ai-cache',
                     "name: ai-answers-${{ matrix.key }}"):
            self.assertIn(part, step)
        self.assertNotIn('always()', step)

    def test_main_after_a_merge_lays_the_prs_answers_over_its_cache_before_the_suite(self):
        names = steps((WORKFLOWS / 'e2e.yml').read_text())
        restore = next(i for i, step in enumerate(names) if 'actions/cache/restore' in step and 'ai-answers-' in step)
        load = next(i for i, step in enumerate(names) if 'pr-answers.mjs' in step and 'run:' in step)
        first = next(i for i, step in enumerate(names) if step.startswith('name: Run the ${{ matrix.key }} suite (the only try)'))
        self.assertLess(restore, load)
        self.assertLess(load, first)
        self.assertIn("inputs.after_merge != ''", names[load])
        self.assertIn("KEY: ${{ matrix.key }}", names[load])


if __name__ == '__main__':
    unittest.main()
