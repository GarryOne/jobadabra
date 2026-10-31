"""Outside-world suite results stay visible without deciding the beta gate."""
import os
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent


class OutsideWorkflow(unittest.TestCase):
    def workflows(self):
        for name, job in [('e2e.yml', 'suite'), ('desktop.yml', 'test-mac')]:
            text = (ROOT / '.github/workflows' / name).read_text()
            block = re.search(rf'(?ms)^  {job}:\n.*?(?=^  [\w-]+:|\Z)', text).group()
            yield name, text, block

    def test_outside_job_is_nonblocking_but_backbone_is_not(self):
        for name, text, block in self.workflows():
            with self.subTest(workflow=name):
                self.assertEqual(re.findall(r'^# Job: (.+)$', text, re.M), ['serve stored answers' if name == 'e2e.yml' else 'run the backbone'])
                self.assertRegex(block, r'(?m)^    continue-on-error: \$\{\{ matrix.tolerant == true \}\}')
                self.assertIn('E2E_NOTION_TOKEN_FAILURESNOTION: ${{ secrets.E2E_NOTION_TOKEN_FAILURESNOTION }}', block)
                self.assertIn('name: e2e-artifacts-' + ('windows-' if 'name: E2E · Windows' in block else '') + '${{ matrix.key }}', block)

    def test_outside_is_not_retried_and_reports_its_one_try(self):
        for name, _, block in self.workflows():
            with self.subTest(workflow=name):
                self.assertFalse([step for step in re.split(r'(?m)^      - ', block) if step.startswith('name: "First try failed:')], 'no job retries a suite (tests/test_e2e_single_try.py)')
                health = next((step for step in re.split(r'(?m)^      - ', block) if step.startswith('name: Outside-world health')), '')
                self.assertIn('if: always() && matrix.tolerant == true', health)
                self.assertIn("OUTCOME: ${{ steps.suite_run.outputs.tolerant_failed == '1' && 'failure' || steps.suite_run.outcome }}", health)
                self.assertIn('tolerant_failed=1', block, 'a tolerant leg ends green with a warning, never a red job (Rule S)')
                script = health.split('run: |\n', 1)[1].replace('${{ matrix.key }}', 'notion-real')
                for outcome, code in [('success', 0), ('failure', 0), ('cancelled', 0), ('skipped', 0)]:
                    done = subprocess.run(['bash', '-e', '-c', script], env={**os.environ, 'OUTCOME': outcome}, capture_output=True, text=True)
                    self.assertEqual(done.returncode, code, done.stderr)
                    self.assertIn(f'::notice title=Outside-world health::notion-real: {outcome}', done.stdout)
                    self.assertIn('does not block beta', done.stdout)

    def test_windows_keeps_the_same_tolerant_boundary(self):
        text = (ROOT / '.github/workflows/desktop.yml').read_text()
        block = text.split('  test-windows:', 1)[1].split('  release-mac:', 1)[0]
        self.assertIn('continue-on-error: ${{ matrix.tolerant == true }}', block)
        self.assertFalse([step for step in re.split(r'(?m)^      - ', block) if step.startswith('name: "First try failed:')])
        self.assertIn('if: always() && matrix.tolerant == true', block)

    def test_outside_does_not_start_a_live_ai_relay(self):
        for name, _, block in self.workflows():
            with self.subTest(workflow=name):
                for step in re.split(r'(?m)^      - ', block):
                    if 'uses: ./.github/actions/free-ai-relay' in step:
                        self.assertIn('if: matrix.offlineAi != true', step)

    def test_the_outside_world_has_its_own_daily_cron_never_a_main_check(self):
        """Gitar on #2502: inferring "the day's first run" from history missed the Worker's dispatches; one cron string decides it."""
        text = (ROOT / '.github/workflows/e2e.yml').read_text()
        cron = re.search(r"(?m)^    - cron: '([^']+)'.*outside world", text).group(1)
        self.assertIn(f"OUTSIDE: ${{{{ github.event.schedule == '{cron}' && '1' || '' }}}}", text)
        self.assertIn(f"github.event.schedule == '{cron}' && 'E2E check · outside world (real Notion)'", text)
        import importlib.util
        spec = importlib.util.spec_from_file_location('main_e2e_state', ROOT / 'tools/main_e2e_state.py')
        state = importlib.util.module_from_spec(spec); spec.loader.exec_module(state)
        run = {'head_branch': 'main', 'conclusion': 'failure', 'display_title': 'E2E check · outside world (real Notion)'}
        self.assertFalse(state.is_main_check(run), 'a Notion outage must never turn main red')
        self.assertTrue(state.is_main_check({**run, 'display_title': 'E2E check · on time (Worker cron)'}))

    def test_beta_summary_distinguishes_required_checks_from_outside_health(self):
        text = (ROOT / '.github/workflows/desktop.yml').read_text()
        release = text.split('  release-mac:', 1)[1].split('  release-windows:', 1)[0]
        self.assertIn('required end-to-end suites passed', release)
        self.assertIn('Outside-world health: see the notion-real job notice and Mac HTML report', release)
