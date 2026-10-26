"""Windows e2e follows main's checks once a UTC day (gate G4, 26 Oct 2026): the Worker's on-time runs (inputs.scheduled) are main's checks, and the
"Windows follows" job used to look only for GitHub's backup schedule, so from 17 Oct Windows ran only inside betas."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def windows_job():
    text = (ROOT / '.github' / 'workflows' / 'e2e.yml').read_text(encoding='utf8')
    start = text.index('\n  windows:\n')
    end = re.search(r'\n  [a-z-]+:\n', text[start + 1:])
    return text[start:start + 1 + end.start()] if end else text[start:]


class WindowsDaily(unittest.TestCase):
    def test_main_checks_by_the_worker_start_windows(self):
        cond = re.search(r'^    if: (.*)$', windows_job(), re.M).group(1)
        for kind in ("github.event_name == 'schedule'", 'inputs.scheduled', 'inputs.gate_tag'):
            self.assertIn(kind, cond)
        for never in ('!inputs.release_run', '!inputs.canary', '!inputs.soak', '!inputs.mutant', '!inputs.bisect'):
            self.assertIn(never, cond)

    def test_once_a_day_outside_a_gate(self):
        script = windows_job().split('- name: Start the Windows run on this commit', 1)[1]
        self.assertIn('GATE: ${{ inputs.gate_tag }}', script)
        self.assertRegex(script, r'if \[ -z "\$GATE" \]; then')
        self.assertIn('date -u +%Y-%m-%d', script)
        self.assertIn("E2E Windows · the Mac run's suites · ", script, 'the title e2e-windows.yml gives a run after a Mac run (plan-windows.mjs macRunTitle)')
        self.assertLess(script.index('exit 0'), script.index('gh workflow run e2e-windows.yml'))
        self.assertTrue(re.search(r'--workflow e2e-windows\.yml --branch main', script))


if __name__ == '__main__':
    unittest.main()
