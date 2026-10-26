"""A warning about a failed AI call is said in the person's words: no topic slug ("pool-region") and no exception class ("AiLimit") reaches the run's warnings (#1287)."""
import io
import re
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ai import decide  # noqa: E402
from src.ai.providers.contract import AiLimit, AiUnavailable, reason  # noqa: E402
import sqlite3  # noqa: E402

LEAK = re.compile(r'AiLimit|AiUnavailable|AiError|Error\b|pool-|[a-z]+-[a-z]+ \(')


class Failing:
    def __init__(self, error):
        self.messages = SimpleNamespace(create=self.create)
        self.error = error

    def create(self, **kwargs):
        raise self.error


class PlainAiWarningTests(unittest.TestCase):
    def test_decide_warning_names_neither_topic_nor_exception(self):
        for error in (AiLimit('limit'), AiUnavailable('busy'), RuntimeError('boom')):
            decide.reset_run()
            self.addCleanup(decide.reset_run)
            out = io.StringIO()
            with redirect_stdout(out):
                decide.decide('pool-region', {'a': 'x'}, ('yes', 'no'), 'task', Failing(error), sqlite3.connect(':memory:'))
                decide._say_waiting()   # the one plain line a run says, at its end
            warnings = [line for line in out.getvalue().splitlines() if line.startswith('Warning:')]
            self.assertEqual(len(warnings), 1, out.getvalue())
            self.assertIsNone(LEAK.search(warnings[0]), warnings[0])

    def test_reason_is_a_sentence_per_kind(self):
        self.assertEqual(reason(AiLimit('x')), 'the AI limit was reached')
        self.assertEqual(reason(AiUnavailable('x')), 'the AI service is busy or unavailable')
        self.assertEqual(reason(ValueError('x')), 'the AI call failed')

    def test_no_warning_line_prints_named_error(self):
        """The class: every `Warning:`/fallback line that used named(error) now says reason(error); the exception class goes to a technical line."""
        bad = []
        for path in (ROOT / 'src').rglob('*.py'):
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if 'print(' in line and 'Technical' not in line and re.search(r'named\(\w+\)', line):
                    bad.append(f'{path.relative_to(ROOT)}:{number}')
        self.assertEqual(bad, [])


if __name__ == '__main__':
    unittest.main()
