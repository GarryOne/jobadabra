"""The Worker's copy of the writing rules equals the engine's (src/ai/writing_rules.py): one source of what good writing is."""
import re
import unittest
from pathlib import Path

from src.ai.writing_rules import RULES

ROOT = Path(__file__).resolve().parents[1]


class WritingRules(unittest.TestCase):
    def test_worker_copy_is_equal(self):
        source = (ROOT / 'app-core/src/writing-rules.js').read_text(encoding='utf-8')
        copy = re.search(r'WRITING_RULES = `(.*)`;', source, re.S).group(1).replace('\\`', '`')
        self.assertEqual(copy, RULES)

    def test_every_prose_prompt_includes_them(self):
        from src.ai import insights, insights_text, kit, prep, rejection
        for name, prompt in (('kit', kit.SYSTEM), ('prep', prep.SYSTEM), ('insight', insights.SYSTEM), ('weekly', insights_text.WEEKLY_SYSTEM), ('rejection', rejection.SYSTEM)):
            self.assertIn(RULES, prompt, f'{name} prompt lacks the writing rules')
        for file in ('app-core/src/written-answer.js', 'desktop/lib/cover-letter.js'):
            self.assertIn('WRITING_RULES', (ROOT / file).read_text(encoding='utf-8'), file)


if __name__ == '__main__':
    unittest.main()
