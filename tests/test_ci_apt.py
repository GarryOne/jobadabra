"""A CI step that installs apt packages never hangs (owner, 25 Oct 2026: a step sat 11m51s on a stalled mirror, "that's way too much").

Every workflow installs through tools/apt-install.sh (apt's own retries and timeouts, a cut on each try, one retry, a clear failure), and every step that
calls it has its own timeout-minutes. This loops over all workflow files, so a new bare apt-get anywhere fails here. Guards: tools/apt-install.sh, .github/workflows/*.yml."""
import os
import re
import shutil
import stat
import subprocess
import tempfile
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
        for needle in ("Acquire::Retries", "Acquire::http::Timeout", "timeout --kill-after=10", "for attempt in 1 2", "::error::apt-install: could not install",
                       "archive.ubuntu.com"):   # try 2 on another mirror (web #154: the runner's mirror stalled 3 times in a row)
            self.assertIn(needle, script)


def run_script(fails=0, stall=""):
    """tools/apt-install.sh with a fake sudo, timeout, sleep and apt-get on PATH and GitHub's runner layout in APT_DIR: install fails `fails` times,
    or the `stall` phase prints apt's last line and exits 124 as `timeout` does when it cuts a command."""
    bin_dir = Path(tempfile.mkdtemp(prefix="apt-"))
    fakes = {
        "sudo": 'if [ "$1" = tee ]; then cat >/dev/null; else exec "$@"; fi',
        "timeout": 'shift; [ "${1#--kill-after}" != "$1" ] && shift; shift; exec "$@"',
        "sleep": "exit 0",
        "stdbuf": 'shift; exec "$@"',
        "apt-get": f'''[ "$1" = update ] && {{ echo "Hit:1 http://azure.archive.ubuntu.com/ubuntu noble InRelease"; [ "{stall}" = update ] && exit 124; exit 0; }}
n=$(cat {bin_dir}/n 2>/dev/null || echo 0); echo $((n+1)) > {bin_dir}/n
[ "{stall}" = install ] && {{ echo "Get:42 http://azure.archive.ubuntu.com/ubuntu noble/universe amd64 libavcodec60"; exit 124; }}
[ $n -lt {fails} ] && exit 100; exit 0''',
    }
    for name, body in fakes.items():
        (bin_dir / name).write_text(f"#!/bin/bash\n{body}\n")
        (bin_dir / name).chmod(stat.S_IRWXU)
    apt = bin_dir / "apt"
    (apt / "sources.list.d").mkdir(parents=True)
    (apt / "sources.list.d" / "ubuntu.sources").write_text("URIs: mirror+file:/etc/apt/apt-mirrors.txt\n")
    # GitHub's Ubuntu runners list their mirrors here; the sources only point at it (web run 40389661253: try 2 still fetched from azure)
    (apt / "apt-mirrors.txt").write_text("http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\n")
    env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "APT_DIR": str(apt)}
    result = subprocess.run(["bash", str(ROOT / "tools" / "apt-install.sh"), "xvfb"], env=env, capture_output=True, text=True)
    mirrors = (apt / "apt-mirrors.txt").read_text()
    shutil.rmtree(bin_dir, ignore_errors=True)
    return result, mirrors


@unittest.skipIf(os.name == "nt" or not shutil.which("bash"), "the script runs on Linux runners only")
class CiAptRuns(unittest.TestCase):
    def test_a_failed_first_try_moves_to_another_mirror_also_in_the_runners_mirror_list(self):
        result, mirrors = run_script(fails=1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r"xvfb ready \(try 2, \d+ s\)")
        self.assertNotIn("azure", mirrors, "try 2 left the stalled mirror (web #154), in apt-mirrors.txt too")

    def test_a_first_try_that_works_keeps_the_runners_mirror(self):
        result, mirrors = run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("azure", mirrors)

    def test_a_stall_names_its_phase_and_apts_last_line(self):
        # 26 Oct 2026: four ~95 s stalls printed nothing ("apt said:" empty under -qq); the next one showed a slow mirror at ~150 KB/s
        result, _ = run_script(stall="install")
        self.assertEqual(result.returncode, 1)
        self.assertIn("try 1: apt-get install cut after 90 s", result.stderr)
        self.assertIn("Get:42 http://azure.archive.ubuntu.com/ubuntu noble/universe amd64 libavcodec60", result.stderr)
        self.assertIn("::error::apt-install: could not install xvfb after 2 tries", result.stderr)
        self.assertIn("try 1: apt-get update cut after 45 s", run_script(stall="update")[0].stderr)


if __name__ == "__main__":
    unittest.main()
