"""Haiku 5.5 (8 Oct 2026): it thinks by default and the thinking counts towards max_tokens, so every Haiku call runs at low
effort and leaves room to think. Haiku 4.5 still gets no effort (it rejects one with a 400)."""
import re
import unittest
from pathlib import Path

from src.ai import engine

ROOT = Path(__file__).resolve().parent.parent


class EffortGate(unittest.TestCase):
    def test_haiku_5_5_runs_at_low_and_haiku_4_5_sends_none(self):
        self.assertEqual(engine.effort_for('claude-haiku-5-5', 'medium'), 'low')
        self.assertEqual(engine.effort_for('claude-haiku-5-5', None), 'low')
        self.assertIsNone(engine.effort_for('claude-haiku-4-5', 'medium'))
        self.assertEqual(engine.effort_for('claude-sonnet-5-5', 'medium'), 'medium')
        self.assertIsNone(engine.effort_for('claude-sonnet-5-5', None))
        self.assertEqual(engine.structured({'a': 1}, 'claude-haiku-5-5', 'high')['effort'], 'low')


class EveryHaikuCall(unittest.TestCase):
    """The class, not the case: any engine file that calls the small model (src/ai/models.py) or names Haiku 5.5."""

    def files(self):
        found = [p for p in (ROOT / 'src').rglob('*.py') if p.name != 'models.py' and ('SMALL_MODEL' in p.read_text() or 'claude-haiku-5-5' in p.read_text())]
        self.assertGreater(len(found), 10)   # the scan itself found the Haiku callers
        return found

    def test_room_to_think(self):
        for path in self.files():
            for n in re.findall(r'max_tokens=(\d+)', path.read_text()):
                self.assertGreaterEqual(int(n), 1000, f'{path.relative_to(ROOT)}: max_tokens={n} leaves Haiku 5.5 no room to think')

    def test_effort_goes_through_the_gate(self):
        for path in self.files():
            self.assertNotIn("startswith('claude-haiku')", path.read_text(), f'{path.relative_to(ROOT)}: use engine.effort_for')
            self.assertNotRegex(path.read_text(), r"output_config=\{'format'", f'{path.relative_to(ROOT)}: use engine.structured')


class SmallModelIsData(unittest.TestCase):
    def test_the_variable_the_app_sets_picks_the_model_and_no_step_hard_codes_one(self):
        import subprocess, sys
        run = lambda env: subprocess.run([sys.executable, '-c', 'from src.ai import models, title_triage; print(models.SMALL_MODEL, title_triage.MODEL)'],
                                         cwd=ROOT, env=env, capture_output=True, text=True, check=True).stdout.split()
        import os
        self.assertEqual(run({**os.environ, 'JOB_PILOTTO_SMALL_MODEL': 'claude-haiku-9'}), ['claude-haiku-9', 'claude-haiku-9'])
        self.assertEqual(run({k: v for k, v in os.environ.items() if k != 'JOB_PILOTTO_SMALL_MODEL'}), ['claude-haiku-5-5', 'claude-haiku-5-5'])
        for path in (ROOT / 'src').rglob('*.py'):
            if path.name not in ('models.py', 'cost.py', 'features.py'):
                self.assertNotRegex(path.read_text(), r"(?m)= '?claude-haiku-[0-9-]+'$", f'{path.relative_to(ROOT)}: use models.SMALL_MODEL')


if __name__ == '__main__':
    unittest.main()


class EveryTierFollowsTheOneModelOverride(unittest.TestCase):
    """The one-model override (JOB_PILOTTO_MODEL_OVERRIDE -> desktop/lib/pipeline-env.js) reaches every tier, so a Haiku-only run never has a
    step on Sonnet or Opus (27 Oct 2026: the job-boards proposal ran Sonnet in the Haiku-only benchmark). Without the variables nothing changes."""
    def test_each_tier_reads_its_variable_and_keeps_its_default(self):
        import os, subprocess, sys
        tiers = 'from src.ai import models; print(*(models.model_for("claude", t) for t in ("small", "main", "big")))'
        run = lambda env: subprocess.run([sys.executable, '-c', tiers], cwd=ROOT, env=env, capture_output=True, text=True, check=True).stdout.split()
        names = ('JOB_PILOTTO_SMALL_MODEL', 'JOB_PILOTTO_MAIN_MODEL', 'JOB_PILOTTO_BIG_MODEL')
        clean = {k: v for k, v in os.environ.items() if k not in names}
        self.assertEqual(run({**clean, **{n: 'claude-haiku-9' for n in names}}), ['claude-haiku-9'] * 3)
        self.assertEqual(run(clean), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
