"""Quality's gate replays only (owner, 27 Oct 2026: "Code gate + AI rate"): its recorded answers never expire, on main a question with no recorded answer is
named red (lib/ai-meter.mjs strict), its retry replays like its first try, and only the night's fresh run asks live. Main 27 Oct 2026: a gate asked 8-12
questions live, got other answers than its PR, and went red with no code change (runs 40434477266, 40440720029)."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github/workflows'
SUITE_WORKFLOWS = ('e2e.yml', 'desktop.yml')


def env_line(text, name):
    found = re.findall(rf'(?m)^      {name}: (.+)$', text)
    return found[0] if len(found) == 1 else None


class QualityReplayGateTests(unittest.TestCase):
    def test_quality_replays_strictly_with_answers_that_never_expire(self):
        for name in SUITE_WORKFLOWS:
            text = (WORKFLOWS / name).read_text()
            with self.subTest(file=name):
                strict = env_line(text, 'E2E_AI_STRICT')
                self.assertIsNotNone(strict, 'one E2E_AI_STRICT for the suite job')
                self.assertIn("matrix.suite == 'quality'", strict)
                self.assertIn("matrix.suite == 'quality' && '3650'", env_line(text, 'E2E_AI_MAX_AGE_DAYS') or '')

    def test_a_prs_own_run_records_and_main_replays_only(self):
        strict = env_line((WORKFLOWS / 'e2e.yml').read_text(), 'E2E_AI_STRICT')
        # A PR's own run (pr_suites set, no after_merge) asks a new question once and records it; every main run is strict.
        self.assertIn("inputs.pr_suites == '' || inputs.after_merge != ''", strict)

    def test_the_nights_fresh_run_is_live_and_not_strict(self):
        text = (WORKFLOWS / 'e2e.yml').read_text()
        fresh = text[text.index('- name: Fresh AI answers for quality once a day'):]
        fresh = fresh[:fresh.index('\n      - name:')]
        self.assertIn('echo "E2E_AI_REPLAY=0"; echo "E2E_AI_STRICT=0"; } >> "$GITHUB_ENV"', fresh)

    def test_qualitys_retry_replays_and_other_suites_retry_fresh(self):
        for name in SUITE_WORKFLOWS:
            text = (WORKFLOWS / name).read_text()
            with self.subTest(file=name):
                self.assertIn('replay=0; [ "${{ matrix.suite }}" != quality ] || replay="$E2E_AI_REPLAY"', text)
                self.assertIn('E2E_RERUN=1 E2E_AI_REPLAY="$replay"', text)
                self.assertNotRegex(text, r'E2E_RERUN=1 E2E_AI_REPLAY=0\b')

    # "Same scores twice" is a rate over the last 90 pairs of the night's live runs (desktop/e2e/lib/quality-rate.mjs): its history is restored for quality
    # and saved after the live run on main even when it is red (a red night must count), never from a PR or a replayed run.
    def test_the_score_steadiness_history_is_kept_between_live_nights(self):
        text = (WORKFLOWS / 'e2e.yml').read_text()
        self.assertIn("E2E_QUALITY_HISTORY: ${{ matrix.suite == 'quality' && format('{0}/desktop/e2e/.quality-rate/history.json', github.workspace) || '' }}", text)
        steps = re.split(r'(?m)^      - ', text)
        restore = [step for step in steps if 'path: desktop/e2e/.quality-rate' in step and 'cache/restore' in step]
        save = [step for step in steps if 'path: desktop/e2e/.quality-rate' in step and 'cache/save' in step]
        self.assertEqual((len(restore), len(save)), (1, 1))
        self.assertIn('restore-keys: quality-rate-', restore[0])
        for condition in ('always()', "matrix.suite == 'quality'", "env.E2E_AI_REPLAY == '0'", "github.ref == 'refs/heads/main'"):
            self.assertIn(condition, save[0])
        self.assertLess(text.index(restore[0]), text.index('- name: Run the ${{ matrix.key }} suite (first try)'))


if __name__ == '__main__':
    unittest.main()
