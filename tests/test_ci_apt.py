"""A CI step that installs apt packages never hangs (owner, 25 Oct 2026: a step sat 11m51s on a stalled mirror, "that's way too much").

Every workflow installs through tools/apt-install.sh (apt's own retries and timeouts, a cut on each try, one retry, a clear failure), and every step that
calls it has its own timeout-minutes. This loops over all workflow files, so a new bare apt-get anywhere fails here. Guards: tools/apt-install.sh, .github/workflows/*.yml."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FLOWS = sorted((ROOT / ".github" / "workflows").glob("*.yml"))


class CiApt(unittest.TestCase):
    def test_no_workflow_calls_apt_get_itself(self):
        bare = [f.name for f in FLOWS if "apt-get" in f.read_text()]
        self.assertEqual(bare, [], "install through tools/apt-install.sh (cut, retried), never a bare apt-get")

    def test_every_apt_install_step_has_its_own_timeout(self):
        seen = 0
        for flow in FLOWS:
            for step in re.split(r"\n {6}- ", flow.read_text()):
                if "apt-install.sh" in step:
                    seen += 1
                    self.assertRegex(step, r"\n\s+timeout-minutes: \d+", f"{flow.name}: step {step.splitlines()[0][:60]!r} has no timeout-minutes")
        self.assertGreaterEqual(seen, 4, "desktop, e2e, record-sites and watch-live all install through the script")

    def test_the_script_cuts_every_try_retries_once_and_fails_with_a_message(self):
        script = (ROOT / "tools" / "apt-install.sh").read_text()
        for needle in ("Acquire::Retries", "Acquire::http::Timeout", "timeout --kill-after=10", "for attempt in 1 2", "::error::apt-install: could not install"):
            self.assertIn(needle, script)


if __name__ == "__main__":
    unittest.main()
