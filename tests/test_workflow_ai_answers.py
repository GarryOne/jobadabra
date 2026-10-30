# Check manual-only AI answer recording, candidate artifacts and the record-run summary.
from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / '.github/workflows/e2e.yml'
RECORD_GUARD = "github.event_name == 'workflow_dispatch' && github.run_attempt == 1 && inputs.ai_answers == 'record'"
BACKBONE = ('quality', 'stores', 'interviews', 'wander', 'activityfailures')


def expression(value, event='workflow_dispatch', mode='off', attempt=1, suite='jobs', burn_in=0):
    """Evaluate ==, &&, || and contains(fromJSON(...), matrix.suite) over workflow inputs."""
    context = {'github.event_name': event, 'inputs.ai_answers': mode, 'github.run_attempt': attempt, 'matrix.suite': suite, 'matrix.burnIn': burn_in}

    def atom(token):
        token = token.strip()
        if re.fullmatch(r"'[^']*'", token):
            return token[1:-1]
        contains = re.fullmatch(r"contains\(fromJSON\('([^']+)'\), matrix\.suite\)", token)
        if contains:
            return suite in json.loads(contains[1])
        if token.isdigit():
            return int(token)
        return context[token]

    result = False
    for alternative in value.removeprefix('${{').removesuffix('}}').strip().split('||'):
        result = True
        for term in alternative.split('&&'):
            parts = term.split('==')
            if result:
                result = atom(parts[0]) if len(parts) == 1 else atom(parts[0]) == atom(parts[1])
        if result:
            return result
    return result


class WorkflowAiAnswers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW.read_text(encoding='utf-8')
        cls.suite = re.search(r'(?ms)^  suite:\n.*?(?=^  [a-z][\w-]*:|\Z)', cls.text).group()
        cls.steps = re.split(r'(?m)^      - ', cls.suite)[1:]

    def step(self, marker):
        found = [step for step in self.steps if marker in step]
        self.assertEqual(len(found), 1, f'exactly one suite step contains {marker!r}')
        return found[0]

    def test_dispatch_off_is_the_default_and_backbone_is_not_offered(self):
        dispatch = self.text.split('  workflow_dispatch:', 1)[1].split('  schedule:', 1)[0]
        input_ = re.search(r'(?ms)^      ai_answers:\n.*?(?=^      \w+:|\Z)', dispatch)
        self.assertIsNotNone(input_, 'manual dispatch needs the ai_answers input')
        for line in ('        type: choice', "        options: ['off', record]", "        default: 'off'"):
            self.assertIn(line, input_.group().splitlines())
        self.assertNotIn('backbone', input_.group())
        called = self.text.split('  workflow_call:', 1)[1].split('\n# Main checks', 1)[0]
        self.assertNotIn('ai_answers:', called)

    def test_only_an_explicit_first_manual_dispatch_records(self):
        first = self.step('id: suite_run')
        mode_line = re.search(r'(?m)^          E2E_AI_ANSWERS: (.+)$', first)
        self.assertIsNotNone(mode_line, 'the suite process must receive its answer mode')
        value = mode_line.group(1)
        # Why (30 Oct 2026, a8, burn-in; ap): an admission leg always replays stored answers, never records; the suite list is BACKBONE.
        self.assertEqual(value, "${{ matrix.burnIn && 'backbone' || " + RECORD_GUARD + " && 'record' || contains(fromJSON('" +
                         json.dumps(list(BACKBONE), separators=(',', ':')) + "'), matrix.suite) && 'backbone' || 'off' }}")
        cases = [('workflow_dispatch', 'record', 1, 'record'),
                 ('workflow_dispatch', 'off', 1, 'off'),
                 ('workflow_dispatch', '', 1, 'off'),
                 ('workflow_dispatch', 'backbone', 1, 'off'),
                 ('workflow_dispatch', 'record', 2, 'off')]
        cases += [(event, 'record', 1, 'off') for event in
                  ('schedule', 'push', 'pull_request', 'workflow_call', 'retry')]
        for event, mode, attempt, want in cases:
            with self.subTest(event=event, mode=mode, attempt=attempt):
                for suite in BACKBONE + ('jobs', 'qualityai', 'apply'):
                    expected = 'backbone' if suite in BACKBONE and want == 'off' else want
                    self.assertEqual(expression(value, event, mode, attempt, suite), expected, suite)
                    self.assertEqual(expression(value, event, mode, attempt, suite, burn_in=3), 'backbone', f'{suite}: a burn-in leg never records')

    def test_the_suites_second_try_uses_backbone_for_declared_suites(self):
        retry = self.step('if again ')
        value = re.search(r'(?m)^          E2E_AI_ANSWERS: (.+)$', retry).group(1)
        for suite in BACKBONE + ('jobs', 'qualityai', 'apply'):
            for mode in ('off', 'record'):
                with self.subTest(suite=suite, mode=mode):
                    self.assertEqual(expression(value, mode=mode, suite=suite),
                                     'backbone' if suite in BACKBONE else 'off')

    def test_candidates_stay_in_the_existing_artifact_upload(self):
        self.assertNotIn('E2E_AI_CANDIDATES', self.suite)
        self.assertIn('      E2E_ARTIFACTS: ${{ github.workspace }}/e2e-artifacts/${{ matrix.key }}', self.suite.splitlines())
        upload = self.step('name: Screenshots and timings')
        for line in ('        if: always()', '        uses: actions/upload-artifact@v6',
                     '          path: e2e-artifacts/${{ matrix.key }}'):
            self.assertIn(line, upload.splitlines())
        self.assertIn('          name: e2e-artifacts-${{ matrix.key }}', upload.splitlines())
        self.assertNotIn('ai-answer-candidates', upload)

    def test_summary_runs_after_failure_but_only_for_record_dispatches(self):
        summary = self.step('name: AI answer candidates written for review')
        condition = re.search(r'(?m)^        if: (.+)$', summary).group(1)
        self.assertEqual(condition, 'always() && ' + RECORD_GUARD)
        guard = condition.removeprefix('always() && ')
        self.assertTrue(expression(guard, mode='record'))
        for event, mode, attempt in [('workflow_dispatch', 'off', 1), ('schedule', 'record', 1),
                                     ('workflow_call', 'record', 1), ('workflow_dispatch', 'record', 2)]:
            self.assertFalse(expression(guard, event, mode, attempt))
        self.assertGreater(self.steps.index(summary), self.steps.index(self.step('if again ')))

    def test_summary_counts_candidate_files_including_items_and_missing_folder(self):
        summary = self.step('name: AI answer candidates written for review')
        self.assertIn('        shell: bash', summary.splitlines())
        self.assertIn(r'''        run: |
          candidates=0
          if [ -d "$E2E_ARTIFACTS" ]; then
            candidates=$(find "$E2E_ARTIFACTS" -type f \( -name 'ai-answers-candidates.json' -o -name 'ai-answers-item-*.json' \) | wc -l | tr -d '[:space:]')
          fi
          echo "AI answers: record run · ${{ matrix.key }} · $candidates candidate file(s) written (in the e2e-artifacts-${{ matrix.key }} artifact)."
''', summary)


if __name__ == '__main__':
    unittest.main()
