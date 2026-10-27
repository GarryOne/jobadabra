"""The UI loop's verdicts run as plain AI calls on its own keys, never an agent session on a shared Claude key, never production's AI.

Owner, 27 Oct 2026, when the Finder went silent on "Credit balance is too low": "Free AI, own key" and "We can use/try a combination of Free AI with
Haiku 5.5 if that gives us better results". desktop/e2e/judge.mjs judges before filing (ui-findings.yml) and on filed issues (ui-verdict.yml), on the
UI loop's own Workers AI token and, for Haiku, its own Anthropic key; a provider limit trips the breaker (ai-budget.mjs --judge).
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / '.github' / 'workflows'
JUDGES = {'ui-findings.yml': '--pending .heal/pending.json', 'ui-verdict.yml': '--issue "$NUMBER"', 'judge-exam.yml': '--exam --out .heal/verdicts.json'}
OWN = ('UI_LOOP_FREE_AI_CF_TOKEN', 'UI_LOOP_FREE_AI_CF_ACCOUNT_ID', 'UI_LOOP_ANTHROPIC_KEY')
SHARED = ('ANTHROPIC_API_KEY', 'UI_FINDINGS_ANTHROPIC_KEY', 'UI_VERDICT_ANTHROPIC_KEY', 'CI_FREE_AI_CF_TOKEN', 'FREE_AI_CF_TOKEN', 'E2E_ANTHROPIC_KEY')


class UiLoopJudgeTests(unittest.TestCase):
    def test_both_passes_call_the_one_call_judge_and_no_agent(self):
        for name, call in JUDGES.items():
            text = (WORKFLOWS / name).read_text()
            with self.subTest(workflow=name):
                self.assertNotIn('anthropics/claude-code-action', text)
                self.assertIn(f'node desktop/e2e/judge.mjs {call}', text)
                self.assertIn('ai-budget.mjs --judge "$RUNNER_TEMP/judge-run.json"', text, 'a provider limit must trip the breaker')
                self.assertIn('ai-budget.mjs --check', text, 'the breaker still pauses the pass')

    def test_no_other_workflow_judges_findings_with_an_agent(self):
        # The class: every workflow that judges a finding (the two passes and the exam) uses judge.mjs. The fixers below are agents that edit code and
        # write a verdict only to say why they changed nothing; any other agent workflow writing a verdict must move to judge.mjs or be named here.
        fixers = {'ui-fix.yml', 'sentry-fix.yml'}
        for path in WORKFLOWS.glob('*.yml'):
            text = path.read_text()
            if path.name not in fixers and 'claude-code-action' in text and re.search(r'verdicts?\.(md|json)|exam-prompt|pending\.json', text):
                self.fail(f'{path.name} judges findings with an agent: use desktop/e2e/judge.mjs')

    def test_only_the_ui_loops_own_keys(self):
        for name in JUDGES:
            text = (WORKFLOWS / name).read_text()
            secrets = set(re.findall(r'secrets\.([A-Z0-9_]+)', text))
            with self.subTest(workflow=name):
                for key in OWN:
                    self.assertIn(key, secrets)
                self.assertFalse(secrets & set(SHARED), f'{name} reads a shared AI key: {sorted(secrets & set(SHARED))}')

    def test_haiku_is_the_default_judge(self):
        # Owner, 27 Oct 2026, on the measured sketch: "Haiku, safe drop" and a $5 monthly cap; without UI_LOOP_ANTHROPIC_KEY judge.mjs uses Free AI.
        for name in JUDGES:
            self.assertIn("UI_JUDGE_SETUP: ${{ vars.UI_JUDGE_SETUP || 'haiku' }}", (WORKFLOWS / name).read_text())


if __name__ == '__main__':
    unittest.main()
