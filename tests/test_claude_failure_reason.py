"""Every claude-code-action workflow prints the API's real error when Claude fails (21-24 Oct 2026: four silent failures)."""
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "tools", "claude-failure-reason.py")


def run(payload):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "out.json")
        with open(p, "w") as f:
            json.dump(payload, f)
        return subprocess.run([sys.executable, "-I", SCRIPT, p], capture_output=True, text=True, check=True).stdout


class FailureReason(unittest.TestCase):
    def test_prints_the_api_error_and_masks_secrets(self):
        out = run([{"type": "system"}, {"type": "result", "is_error": True, "api_error_status": 400,
                   "result": "Credit balance is too low (key sk-ant-api03-abc_DEF-123)"}])
        self.assertIn("::error::Claude did not run; the API said: HTTP 400: Credit balance is too low", out)
        self.assertNotIn("sk-ant", out)

    def test_silent_when_nothing_failed(self):
        self.assertEqual(run([{"type": "result", "is_error": False, "result": "ok"}]), "")

    def test_missing_file_is_fine(self):
        r = subprocess.run([sys.executable, "-I", SCRIPT, "/nonexistent.json"], capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_every_claude_workflow_has_the_step(self):
        for path in glob.glob(os.path.join(ROOT, ".github", "workflows", "*.yml")):
            text = open(path, encoding="utf-8").read()
            if "claude-code-action@" in text:
                self.assertRegex(text, r"if: failure\(\)\n\s+run: python3 tools/claude-failure-reason\.py",
                                 os.path.basename(path))


if __name__ == "__main__":
    unittest.main()
