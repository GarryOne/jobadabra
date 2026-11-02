"""Which inputs produced a kit, so the app can say whether it's still current.

A kit is drafted from the CV, the scoring part of the Profile (score.scoring_profile: contact and links left out)
and the standard answers. Their fingerprints go on the job's Applications row ("Kit inputs", e.g.
"cv:3f2a91c0d4e1 profile:9b0e… answers:77c1…"); the Jobs list compares them with today's inputs:
current (all the same), earlier (one changed since: "Drafted with earlier inputs"), unknown (a kit from before this
was recorded). Nothing is redrafted by itself.
"""
import hashlib
import os
from pathlib import Path

from . import score

COLUMN = 'Kit inputs'
CV_PATH = os.getenv('JOBADABRA_CV_PATH', '')


def fingerprint(data):
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data or b'').hexdigest()[:12]


def kit_inputs(profile, answers, cv_path=None):
    """"cv:… profile:… answers:…" for the inputs a kit is drafted from now."""
    path = Path(cv_path or CV_PATH) if (cv_path or CV_PATH) else None
    cv = fingerprint(path.read_bytes()) if path and path.is_file() else 'none'
    return f'cv:{cv} profile:{fingerprint(score.scoring_profile(profile))} answers:{fingerprint(answers or "")}'


def record_kit(stores, page, profile, answers, cv_path=None):
    """Write the kit's inputs on the job in the active store (Notion: "Kit inputs"); never fails a kit."""
    try:
        stores.applications.update(page['id'], {'kit_inputs': kit_inputs(profile, answers, cv_path)})
    except Exception as error:  # noqa: BLE001
        print(f'Warning: kit inputs not recorded: {type(error).__name__}: {error}')


def kit_state(recorded, current):
    """'current', 'earlier' (which inputs changed: 'earlier:cv,profile') or 'unknown' (no fingerprint recorded)."""
    if not recorded or not current:
        return 'unknown'
    parse = lambda text: dict(part.split(':', 1) for part in text.split() if ':' in part)
    old, now = parse(recorded), parse(current)
    changed = [name for name in ('cv', 'profile', 'answers') if old.get(name) != now.get(name)]
    return 'current' if not changed else 'earlier:' + ','.join(changed)
