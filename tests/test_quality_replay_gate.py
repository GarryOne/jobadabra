"""Quality and stores replay declared answers on both tries; qualityai keeps its live path."""
import re
import unittest
from pathlib import Path
from tests.test_workflow_ai_answers import expression

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github/workflows'
SUITE_WORKFLOWS = ('e2e.yml', 'desktop.yml')


def env_line(text, name):
    found = re.findall(rf'(?m)^      {name}: (.+)$', text)
    return found[0] if len(found) == 1 else None


class QualityReplayGateTests(unittest.TestCase):
    def test_quality_uses_stored_answers_on_both_tries_for_pr_and_main(self):
        for name, job in (('e2e.yml', 'suite'), ('desktop.yml', 'test-mac')):
            text = (WORKFLOWS / name).read_text()
            suite = re.search(rf'(?ms)^  {job}:\n.*?(?=^  [a-z][\w-]*:|\Z)', text).group()
            job_env = re.search(r'(?m)^      E2E_AI_ANSWERS: (.+)$', suite)
            steps = re.split(r'(?m)^      - ', suite)[1:]
            for marker in ('id: suite_run', 'if again '):
                step = next(step for step in steps if marker in step)
                mode = re.search(r'(?m)^          E2E_AI_ANSWERS: (.+)$', step) or job_env
                self.assertIsNotNone(mode, f'{name}: {marker} needs a stored-answer mode')
                for event in ('pull_request', 'workflow_call', 'push', 'schedule', 'workflow_dispatch'):
                    for attempt in (1, 2):
                        with self.subTest(file=name, step=marker, event=event, attempt=attempt):
                            self.assertEqual(expression(mode.group(1), event=event, attempt=attempt, suite='quality'), 'backbone')
                            if name == 'e2e.yml':
                                for stored in ('stores', 'jobs'):
                                    self.assertEqual(expression(mode.group(1), event=event, attempt=attempt, suite=stored), 'backbone')
                            for other in ('qualityai', 'apply'):
                                self.assertEqual(expression(mode.group(1), event=event, attempt=attempt, suite=other), 'off')

    def test_desktop_uses_default_history_judgment(self):
        self.assertNotIn('E2E_QUALITY_JUDGE_HISTORY', (WORKFLOWS / 'desktop.yml').read_text())

    def test_dispatched_pr_suites_report_history_but_nightly_beta_and_after_merge_judge_it(self):
        value = env_line((WORKFLOWS / 'e2e.yml').read_text(), 'E2E_QUALITY_JUDGE_HISTORY')
        self.assertIsNotNone(value)
        for label, suites, after, event, want in [
                ('PR dispatch', 'qualityai', '', 'workflow_dispatch', '0'),
                ('after merge', 'qualityai', 'merged-sha', 'workflow_dispatch', '1'),
                ('nightly', '', '', 'schedule', '1'),
                ('beta dispatch', '', '', 'workflow_dispatch', '1')]:
            with self.subTest(run=label):
                expression_value = value.replace('inputs.pr_suites', repr(suites)).replace('inputs.after_merge', repr(after))
                self.assertEqual(expression(expression_value, event=event), want)

    def test_quality_no_longer_sets_hash_strictness_or_expiry(self):
        for name in SUITE_WORKFLOWS:
            text = (WORKFLOWS / name).read_text()
            self.assertNotRegex(text, r'(?m)^\s+E2E_AI_STRICT:')
            self.assertNotRegex(text, r'(?m)^\s+E2E_AI_MAX_AGE_DAYS:')

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
                self.assertEqual(strict, '')

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
        self.assertIn('rateVerdict(record(scored), scored)', live)
        self.assertNotIn('replaying()', live)
        self.assertNotIn('judgeVerdict', live)
        self.assertIn('if (problems.length) throw new Error(`${problems.length} wrong or missing fact(s)', backbone)
        self.assertIn('if (over.length) throw new Error(`a job with an unmet stated requirement is scored too high:', backbone)
        self.assertNotIn('factsVerdict', backbone)
        self.assertNotIn('flagsVerdict', backbone)


if __name__ == '__main__':
    unittest.main()
