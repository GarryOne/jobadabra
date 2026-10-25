"""The Mac app's data folder as it is now: Jobadabra, or the folder from before the rename on an install not moved yet (desktop/lib/app-identity.js)."""
from pathlib import Path

SUPPORT = Path.home() / 'Library' / 'Application Support'
NAMES = ('Jobadabra', 'Job Pilotto')   # the folder name before the rename comes second


def app_data_dir():
    return next((SUPPORT / name for name in NAMES if (SUPPORT / name).is_dir()), SUPPORT / NAMES[0])
