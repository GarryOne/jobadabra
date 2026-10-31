"""A suite's one try is the verdict (owner, 31 Oct 2026: "Is this expected? Error but step passed green ?", "And why should we accept/allow that?", "Let's go and handle this").
No e2e or desktop workflow runs a suite twice on one commit to turn a red into a pass, and no suite-run step may fail quietly: a failed try shows a red step and a red job.
Two other reruns stay out of scope: red-main-gate's re-check (it runs only after new commits landed) and the picked-step fallback (a stale pick ran nothing, so the whole suite runs
once), plus the Edge pass of the apply suite (another browser, not another try).
Spec: docs/superpowers/specs/2026-10-28-e2e-reliability-design.md, "No retry that hides a symptom" and rule L. Job: report health"""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
SUITE_RUN = re.compile(r'(?m)^\s+(?:run: )?.*\bnode suite\.mjs\b')
RETRY_WORDS = re.compile(r'E2E_RERUN|flaky-proof|flaky\.json|e2e-rerun|suite_retry|First try failed|once more, to tell flaky|rerun-passed')


def steps(text):
    """-> [(name, block)] for every step of every job (steps are `      - ` items)."""
    out = []
    for block in re.split(r'(?m)^      - ', text)[1:]:
        name = re.search(r'(?m)^(?:name: |        name: )(.+)$', block)
        out.append((name.group(1).strip().strip('"') if name else '', block))
    return out


def suite_steps():
    found = []
    for path in sorted(WORKFLOWS.glob('*.yml')):
        for name, block in steps(path.read_text(encoding='utf-8')):
            code = '\n'.join(line for line in block.splitlines() if not line.lstrip().startswith('#'))
            if SUITE_RUN.search(code):
                found.append((path.name, name, block))
    return found


class SingleTryVerdict(unittest.TestCase):
    def test_positive_control_the_suite_steps_are_read(self):
        files = {file for file, _, _ in suite_steps()}
        self.assertTrue({'e2e.yml', 'desktop.yml', 'e2e-windows.yml'} <= files, files)
        self.assertGreaterEqual(len(suite_steps()), 6)

    def test_no_suite_step_may_fail_under_a_green_tick(self):
        quiet = [f'{file}: {name}' for file, name, block in suite_steps() if re.search(r'(?m)^        continue-on-error:', block)]
        self.assertEqual(quiet, [], 'a suite step with continue-on-error draws its failure green (owner, 31 Oct 2026); its own exit code is the verdict')

    def test_no_workflow_retries_a_red_suite(self):
        found = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, block in steps(path.read_text(encoding='utf-8')):
                code = '\n'.join(line for line in block.splitlines() if not line.lstrip().startswith('#'))
                if RETRY_WORDS.search(code) or re.search(r"(?m)^\s+if: .*steps\.suite_run\.outcome == 'failure'", block):
                    found.append(f'{path.name}: {name}')
        self.assertEqual(found, [], 'a step that runs a suite again after a red one passes a job the suite failed')

    def test_a_suite_runs_once_per_step_except_the_stale_pick_fallback(self):
        twice = []
        for file, name, block in suite_steps():
            code = '\n'.join(line for line in block.splitlines() if not line.lstrip().startswith('#'))
            code = re.sub(r'(?m)^\s*once\(\) \{.*\}\s*$', '', code)   # the helper's Linux/else branches are one run
            runs = len(re.findall(r'node suite\.mjs|(?m:^|[;&|{]\s*)once \$', code))
            fallback = 'red-steps.mjs --renamed-only' in code
            if fallback:
                self.assertIn('unset E2E_STEP_NAMES', code, f'{file}: the fallback runs the whole suite, not the same picked steps again')
            if runs > (2 if fallback else 1):
                twice.append(f'{file}: {name} ({runs} runs)')
        self.assertEqual(twice, [])
        self.assertTrue(any('red-steps.mjs --renamed-only' in block for _, _, block in suite_steps()), 'positive control: the fallback is read')

    def test_a_failed_backbone_try_exits_nonzero_and_only_a_tolerant_leg_may_end_green(self):
        # Why (31 Oct 2026, Gitar on #2682): Rule S keeps AI/clock/outside legs grey or green; every other failed try is red by its own exit code.
        for file in ('e2e.yml', 'desktop.yml'):
            blocks = [block for f, _, block in suite_steps() if f == file and 'id: suite_run' in block]
            self.assertTrue(blocks, file)
            for block in blocks:
                code = '\n'.join(line for line in block.splitlines() if not line.lstrip().startswith('#'))
                self.assertRegex(code, r'::error title=Suite failed::[^\n]*"; exit 1', file)
                self.assertEqual(code.count('exit 0'), 2 if 'if [ ! -f "suites/' in code else 1, f'{file}: exit 0 only for a missing suite file and a tolerant leg')
                self.assertIn('matrix.tolerant', code.split('::error', 1)[0].rsplit('||', 1)[-1], f'{file}: the only green exit after a failure is the tolerant leg')

    def test_a_failed_tolerant_try_keeps_no_ai_answers(self):
        # Why (31 Oct 2026, Gitar on #2682): a tolerant leg exits 0 after a failed try, so success() is true; every step that keeps or hands on .ai-cache answers must also ask tolerant_failed.
        gated = 0
        for file in ('e2e.yml', 'desktop.yml'):
            text = (WORKFLOWS / file).read_text(encoding='utf-8')
            for line in text.splitlines():
                if re.search(r'\bif: .*success\(\).*hashFiles\(.desktop/e2e/\.ai-cache', line):
                    gated += 1
                    self.assertIn("steps.suite_run.outputs.tolerant_failed != '1'", line, f'{file}: {line.strip()[:90]}')
        self.assertGreaterEqual(gated, 4, 'positive control: the cache-save and hand-off steps are read')

    def test_the_only_try_is_named_so(self):
        for file in ('e2e.yml', 'desktop.yml', 'e2e-windows.yml'):
            names = [name for f, name, block in suite_steps() if f == file and 'id: suite_run' in block or f == file and name.startswith('Run the ')]
            self.assertTrue(names, file)
            for name in names:
                self.assertNotIn('first try', name.lower(), f'{file}: "{name}" suggests a second try exists')


if __name__ == '__main__':
    unittest.main()
