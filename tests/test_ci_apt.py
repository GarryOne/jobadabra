"""A CI step that installs apt packages never hangs (owner, 25 Oct 2026: a step sat 11m51s on a stalled mirror, "that's way too much").

Every workflow installs through tools/apt-install.sh (apt's own retries and timeouts, a cut on each try, one retry, a clear failure), and every step that
calls it has its own timeout-minutes. This loops over all workflow files, so a new bare apt-get anywhere fails here. Guards: tools/apt-install.sh, .github/workflows/*.yml.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
FLOWS = sorted((ROOT / ".github" / "workflows").glob("*.yml"))


def test_no_workflow_calls_apt_get_itself():
    bare = [f.name for f in FLOWS if "apt-get" in f.read_text()]
    assert not bare, f"install through tools/apt-install.sh (cut, retried), never a bare apt-get: {bare}"


def test_every_apt_install_step_has_its_own_timeout():
    for flow in FLOWS:
        steps = re.split(r"\n {6}- ", flow.read_text())
        for step in steps:
            if "apt-install.sh" in step:
                assert re.search(r"\n\s+timeout-minutes: \d+", step), f"{flow.name}: step {step.splitlines()[0][:60]!r} has no timeout-minutes"


def test_the_script_cuts_every_try_retries_once_and_fails_with_a_message():
    script = (ROOT / "tools" / "apt-install.sh").read_text()
    for needle in ("Acquire::Retries", "Acquire::http::Timeout", "timeout --kill-after=10", "for attempt in 1 2", "::error::apt-install: could not install"):
        assert needle in script, needle
