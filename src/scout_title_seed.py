"""Source scout, title kinds counted elsewhere: the job titles of the whole index judged by kind of role on the owner's Mac through his Claude plan
(tools/recount_title_kinds.py; owner, 26 Oct 2026: "do that from local, to rely on subscription. not costs"), loaded into the scout's kept
decisions once a run, so its capped AI calls go to new titles only and every mix counts with the 19 kinds at once.
The file comes from the private repo (central-scout.yml: SCOUT_TITLE_KINDS=ops/config/title_kinds.json.gz); none there: nothing changes.
Tests: tests/test_recount_title_kinds.py."""
import gzip
import json
import os
from pathlib import Path

from . import role_kinds
from .ai import decide

_loaded = []


def load(path=None, db=None):
    """Kinds from the seed file into the decisions (titles kept since role_kinds.SINCE are left as they are); how many were added. Once a process."""
    if _loaded and path is None:
        return 0
    _loaded.append(True)
    path = Path(path or os.getenv('SCOUT_TITLE_KINDS') or '')
    if not str(path) or not path.is_file():
        return 0
    try:
        with gzip.open(path, 'rt', encoding='utf-8') as handle:
            found = json.load(handle)
    except (OSError, ValueError) as error:
        print(f'Warning: the title kinds seed was not read ({type(error).__name__}); the scout asks its AI as before')
        return 0
    if not isinstance(found, dict):
        return 0
    added = decide.remember('job-title-kind', found, role_kinds.KINDS, role_kinds.SINCE, db)
    print(f'Scout: {added} job title kinds from the seed counted on the plan ({len(found)} in the file)')
    return added
