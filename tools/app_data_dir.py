"""The Mac app's data folder as it is now: Jobadabra, or Job Pilotto on an install not moved yet (desktop/lib/app-identity.js)."""
from pathlib import Path

SUPPORT = Path.home() / 'Library' / 'Application Support'


def app_data_dir():
    return next((SUPPORT / name for name in ('Jobadabra', 'Job Pilotto') if (SUPPORT / name).is_dir()), SUPPORT / 'Jobadabra')
