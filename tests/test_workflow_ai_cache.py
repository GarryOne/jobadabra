"""The e2e AI-answer cache keeps only answers from a green job, and a suite's second try asks the model again (26 Oct 2026: main's mailreading went red on one
bad Free AI draw; the cache saved it (`always()`), the second try replayed it, and every later run replayed it too, so a rerun could never tell flaky from real)."""
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

    def test_mailreadings_poisoned_entries_never_restore(self):
        # Only mailreading held a bad draw (26 Oct 2026); bumping every suite made the quality suite draw fresh from Free AI and fail on its own instability.
        for name in FILES:
            text = (WORKFLOWS / name).read_text()
            with self.subTest(file=name):
                self.assertNotIn('ai-answers-v2-', text)
                self.assertIn("matrix.key == 'mailreading' && '-v2'", text)

    def test_every_second_try_draws_fresh_answers(self):
        for name in ('e2e.yml', 'desktop.yml'):
            text = (WORKFLOWS / name).read_text()
            with self.subTest(file=name):
                self.assertRegex(text, r'E2E_RERUN=1[^\n]*E2E_AI_REPLAY=0|E2E_AI_REPLAY=0[^\n]*E2E_RERUN=1')


if __name__ == '__main__':
    unittest.main()
