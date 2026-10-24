"""Internal CI and release workflows message "Jobadabra · CI alerts", never the product bot that sends the owner's job digest.

17 Oct 2026: the monthly PR-check scorecard (and release-guard) posted through secrets.TELEGRAM_BOT_TOKEN, the bot of the user's own pipeline;
the owner: "this is product internal. Shouldn't come here." Pipeline · workflows (daily, mail, scout) keep the product bot: they are the user's own.
"""
import pathlib
import re
import unittest

WORKFLOWS = pathlib.Path(__file__).resolve().parent.parent / '.github' / 'workflows'
PRODUCT_BOT = re.compile(r'secrets\.TELEGRAM_(BOT_TOKEN|CHAT_ID)\b')


class TelegramBotTest(unittest.TestCase):
    def test_ci_and_release_workflows_never_read_the_product_bot(self):
        internal = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text()
            name = re.search(r'^name:\s*(.+)$', text, re.M)
            if name and name.group(1).strip().strip('\'"').startswith(('CI ·', 'Release ·')):
                internal.append(path.name)
                self.assertIsNone(PRODUCT_BOT.search(text), f'{path.name} posts through the product bot: use secrets.CI_ALERTS_TELEGRAM_BOT_TOKEN / CI_ALERTS_TELEGRAM_CHAT_ID')
        self.assertIn('pr-check-scorecard.yml', internal)
        self.assertIn('release-guard.yml', internal)


if __name__ == '__main__':
    unittest.main()
