"""Quality's gate replays only (owner, 27 Oct 2026: "Code gate + AI rate"): its recorded answers never expire, on main a question with no recorded answer is
named red (lib/ai-meter.mjs strict), its retry replays like its first try, and the separate qualityai journey always asks live. Main 27 Oct 2026: a gate asked 8-12
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

    def test_live_quality_needs_no_separate_fresh_night_step(self):
        text = (WORKFLOWS / 'e2e.yml').read_text()
        self.assertNotIn('Fresh AI answers for qualityai once a day', text)
        self.assertNotIn('echo "E2E_AI_REPLAY=0"', text)
        self.assertIn("matrix.suite == 'qualityai' && '0' || '1'", env_line(text, 'E2E_AI_REPLAY') or '')

    def test_qualitys_retry_replays_and_other_suites_retry_fresh(self):
        for name in SUITE_WORKFLOWS:
            text = (WORKFLOWS / name).read_text()
            with self.subTest(file=name):
                self.assertIn('replay=0; [ "${{ matrix.suite }}" != quality ] || replay="$E2E_AI_REPLAY"', text)
                self.assertIn('E2E_RERUN=1 E2E_AI_REPLAY="$replay"', text)
                self.assertNotRegex(text, r'E2E_RERUN=1 E2E_AI_REPLAY=0\b')

    def test_qualityai_always_runs_live_without_strict_replay(self):
        for name in SUITE_WORKFLOWS:
            text = (WORKFLOWS / name).read_text()
            with self.subTest(file=name):
                replays = re.findall(r'(?m)^      E2E_AI_REPLAY: (.+)$', text)
                self.assertTrue(replays)
                for replay in replays:
                    self.assertIn("matrix.suite == 'qualityai' && '0' || '1'", replay)
                strict = env_line(text, 'E2E_AI_STRICT') or ''
                self.assertNotIn('qualityai', strict)
                self.assertIn("matrix.suite == 'quality'", strict)

    # A retry adds each part of its night once; red live nights count, PRs never save the history.
    def test_the_score_steadiness_history_is_kept_for_qualityai_only(self):
        for name in SUITE_WORKFLOWS:
            text = (WORKFLOWS / name).read_text()
            with self.subTest(file=name):
                self.assertIn("E2E_QUALITY_HISTORY: ${{ matrix.suite == 'qualityai' && format('{0}/desktop/e2e/.quality-rate/history.json', github.workspace) || '' }}", text)
                steps = re.split(r'(?m)^      - ', text)
                restore = [step for step in steps if 'path: desktop/e2e/.quality-rate' in step and 'cache/restore' in step]
                save = [step for step in steps if 'path: desktop/e2e/.quality-rate' in step and 'cache/save' in step]
                self.assertEqual((len(restore), len(save)), (1, 1))
                self.assertIn("if: matrix.suite == 'qualityai'", restore[0])
                self.assertIn('restore-keys: quality-rate-', restore[0])
                for condition in ('always()', "matrix.suite == 'qualityai'", "env.E2E_AI_REPLAY != '1'", "github.ref == 'refs/heads/main'"):
                    self.assertIn(condition, save[0])
                self.assertLess(text.index(restore[0]), text.index('id: suite_run'))

    def test_the_live_suite_judges_facts_and_judge_flags_by_rate_and_backbone_is_exact(self):
        root = WORKFLOWS.parent.parent
        live = (root / 'desktop/e2e/suites/qualityai.mjs').read_text()
        backbone = (root / 'desktop/e2e/suites/quality.mjs').read_text()
        self.assertIn('factsVerdict(record(', live)
        self.assertIn('flagsVerdict(record(', live)
        self.assertNotIn('replaying()', live)
        self.assertNotIn('judgeVerdict', live)
        self.assertIn('if (problems.length) throw new Error(`${problems.length} wrong or missing fact(s)', backbone)
        self.assertIn('if (over.length) throw new Error(`a job with an unmet stated requirement is scored too high:', backbone)
        self.assertNotIn('factsVerdict', backbone)
        self.assertNotIn('flagsVerdict', backbone)


if __name__ == '__main__':
    unittest.main()
