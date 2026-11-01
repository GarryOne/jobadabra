"""A Gmail check that read nothing says why in the chosen engine family's words (src/ai/mail_failure.py; the app: desktop/lib/run-result.js)."""
import unittest

from src.ai import mail_failure
from src.ai.providers.contract import AiLimit


class MailFailureFamily(unittest.TestCase):
    def test_openai_family_gets_openai_words(self):
        env = {'JOBADABRA_AI_ENGINE': 'codex'}
        plan = AiLimit("Codex: your ChatGPT plan's usage limit is reached, so this AI step is paused")
        credit = AiLimit('OpenAI: your API account has no credit left or reached its spend limit (platform.openai.com → Billing)', final=True)
        signed_out = AiLimit('Codex is not signed in on this computer: open Terminal, run `codex login`', final=True)
        self.assertEqual(mail_failure.failure_cause(plan), 'plan')
        self.assertEqual(mail_failure.failure_cause(credit), 'spend')
        self.assertEqual(mail_failure.failure_cause(signed_out), 'claude')
        self.assertEqual(mail_failure.not_checked('spend', env), mail_failure.NOT_CHECKED_OPENAI['spend'])
        self.assertNotIn('Anthropic', mail_failure.not_checked('spend', env))

    def test_claude_family_keeps_its_words(self):
        self.assertEqual(mail_failure.not_checked('plan', {'JOBADABRA_AI_ENGINE': 'cli'}), mail_failure.NOT_CHECKED['plan'])
        self.assertEqual(mail_failure.not_checked('spend', {}), mail_failure.NOT_CHECKED['spend'])
        self.assertEqual(set(mail_failure.NOT_CHECKED_OPENAI), set(mail_failure.NOT_CHECKED))


if __name__ == '__main__':
    unittest.main()
