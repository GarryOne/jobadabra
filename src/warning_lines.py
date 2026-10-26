"""Which log lines are warnings: the ONE rule the app's run panel (desktop/renderer/run-warnings.js) and the engine's row Status share.

A run that logs a warning-like line (Notion busy with 429, a step skipped or failed...) must also record it in run['warnings'], so the row's Status ("Warnings") and the panel
(which reads the log) agree by construction (beta 2, 25 Oct 2026: the list said "Completed", the panel "Completed with warnings" for a logged Notion 429).
Guarded by tests/test_warning_lines.py and desktop/test/warning-lines-parity.test.js, which read the same cases (tests/fixtures/warning_lines.json).
"""
import re

WARNING = re.compile(r'^Warning|\b429\b|Too Many Requests|\b(?:skipped|failed)\b|^AI limit reached', re.I)
ZERO = re.compile(r'\b0 (?:failed|skipped)\b', re.I)
CAP = 180


def _shorten(text):
    """Long API errors are capped, but at a word (the panel's shorten)."""
    return text if len(text) <= CAP else re.sub(r'\s+\S*$', '', text[:CAP]) + '…'


def is_warning(line):
    return bool(WARNING.search(ZERO.sub('', str(line))))


def warning_lines(lines):
    """The warnings in `lines`, each once, as the panel says them: no "Warning:" prefix, capped at a word."""
    out = []
    for line in lines:
        if is_warning(line):
            text = _shorten(re.sub(r'^Warning:\s*', '', str(line), flags=re.I))
            if text not in out:
                out.append(text)
    return out


def record_logged_warnings(run, lines):
    """Add to run['warnings'] every warning the run logged and has not recorded yet (what status() and the report read)."""
    known = {re.sub(r'^Warning:\s*', '', str(w), flags=re.I) for w in run.get('warnings') or []}
    extra = [w for w in warning_lines(lines) if w not in known]
    if extra:
        run['warnings'] = list(run.get('warnings') or []) + extra
    return run
