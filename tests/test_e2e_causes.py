"""Why an e2e suite job went red (tools/e2e_causes.py): the first red step decides, so the env dump and later steps never do."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import e2e_causes as c  # noqa: E402

CREDIT = ('✗ the settings suite stopped: E2E_ANTHROPIC_KEY: the API refused model claude-haiku-5-5 (400) before any suite ran: '
          '"Your credit balance is too low to access the Anthropic API"')


class Causes(unittest.TestCase):
    def test_environment_causes(self):
        self.assertEqual(c.classify(CREDIT)[0], 'ai-key')
        self.assertEqual(c.classify('✗ x: the Free AI relay at http://127.0.0.1:8787/api/ai is not answering (ECONNREFUSED)')[0], 'ai-key')
        self.assertEqual(c.classify("✗ x: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")[0], 'environment')
        self.assertTrue(set(c.ENVIRONMENT_CAUSES) == {'ai-key', 'environment'})

    def test_the_env_dump_never_decides(self):
        log = ('stores\tUNKNOWN STEP\t2026-10-23T23:55:03Z   E2E_ANTHROPIC_KEY: ***\n'
               "stores\tUNKNOWN STEP\t2026-10-23T23:57:04Z ✗ the board shows the store's applications in their stage columns: a card is in the wrong column\n")
        self.assertEqual(c.classify(log)[0], 'check-failed')
        self.assertEqual(c.classify('✗ x: locator.click: Timeout 30000ms exceeded.')[0], 'timeout')


if __name__ == '__main__':
    unittest.main()
