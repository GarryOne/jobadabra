"""No workflow `if:` compares an env value with 0: GitHub turns null and '0' both into the number 0, so an unset env.X reads as '0' there.
The private site repo has the same guard (jobadabra-web test/tools/media-tests-when-reached.test.js) and reads these workflows, so a public PR that
broke it turned web's main red after the merge (e2e.yml's quality-history save, `env.E2E_AI_REPLAY == '0'`, 27 Oct 2026). This copy fails on the PR."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github/workflows'
ENV_ZERO = re.compile(r"\benv\.\w+\s*[!=]=\s*'?0'?(?![\w.])|'?0'?\s*[!=]=\s*env\.")


class WorkflowEnvZeroTests(unittest.TestCase):
    def test_no_if_compares_an_env_value_with_zero(self):
        bad = [f'{path.name}:{number} {line.strip()}' for path in sorted(WORKFLOWS.glob('*.y*ml'))
               for number, line in enumerate(path.read_text().split('\n'), 1) if re.search(r'\bif:', line) and ENV_ZERO.search(line)]
        self.assertEqual(bad, [], "compare with '1' (or check github.event_name) instead")

    def test_the_pattern_catches_the_shapes_that_broke_main(self):
        for line in ("if: env.E2E_AI_REPLAY == '0'", "if: env.MEDIA_TOOLS != '0'", 'if: env.X == 0', "if: '0' == env.X"):
            self.assertTrue(ENV_ZERO.search(line), line)
        for line in ("if: env.E2E_AI_REPLAY != '1'", "if: vars.JOB_PILOTTO_RENDER != '0'", "if: needs.plan.outputs.count != '0'", "if: env.X == '0.5'"):
            self.assertFalse(ENV_ZERO.search(line), line)


if __name__ == '__main__':
    unittest.main()
