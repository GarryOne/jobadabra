"""Each AI step names itself to the relay that carries included AI (header x-jp-action), so what each step costs can be told apart."""
import re
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import engine  # noqa: E402


class FakeAnthropic:
    made = []

    def __init__(self, **kwargs):
        FakeAnthropic.made.append(kwargs)


class ActionHeaderTest(unittest.TestCase):
    def setUp(self):
        FakeAnthropic.made = []
        self.module = types.SimpleNamespace(Anthropic=FakeAnthropic)

    def test_a_named_step_sends_its_name_and_nothing_else(self):
        with mock.patch.dict(sys.modules, {'anthropic': self.module}):
            engine.client(env={'JOB_PILOTTO_AI_ENGINE': 'api'}, action='score')
            engine.client(env={}, action='kit')
        self.assertEqual(FakeAnthropic.made, [{'default_headers': {'x-jp-action': 'score'}}, {'default_headers': {'x-jp-action': 'kit'}}])

    def test_an_unknown_or_missing_step_sends_no_header(self):
        with mock.patch.dict(sys.modules, {'anthropic': self.module}):
            engine.client(env={}, action='send-my-cv')
            engine.client(env={})
        self.assertEqual(FakeAnthropic.made, [{}, {}])

    def test_every_ai_step_in_the_engine_names_itself(self):
        root = Path(__file__).resolve().parents[1]
        missing = []
        for path in list((root / 'src').rglob('*.py')):
            if path.name == 'engine.py':
                continue
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if 'engine.client(' in line and "action='" not in line:
                    missing.append(f'{path.relative_to(root)}:{number}')
        self.assertEqual(missing, [], 'every engine.client() call names its step: engine.client(action="score")')
        # Every name a call can send, also one picked inside the call (`action='a' if ... else 'b'`); names have underscores (26 Oct 2026: `[a-z]+` missed
        # 14 steps such as title_triage, so Free AI logged 517 calls as "other" on /admin/intelligence/ai-cost).
        used = {step for path in (root / 'src').rglob('*.py') for call in re.findall(r"engine\.client\(action=([^)]*)\)", path.read_text())
                for step in re.findall(r"'([a-z_]+)'", call)}
        self.assertGreater(len(used), 25)
        self.assertEqual(sorted(used - set(engine.ACTIONS)), [], 'a step the engine does not name to Free AI: add it to ACTIONS (src/ai/providers/anthropic_api.py) '
                         'and to shared/aicost.js ACTIONS in jobadabra-web (the site lands first)')


if __name__ == '__main__':
    unittest.main()
