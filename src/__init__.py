# Loaded first by every entry point: .env, then the Desktop App's workspace for anything .env doesn't set.
# run_result registers the process exit that writes the app's result file (one object per command).
from . import paths as _paths  # noqa: F401,E402
from . import run_result as _run_result  # noqa: F401,E402
# The persona search check's tape (src/search_tape.py): only when JOBADABRA_SEARCH_TAPE is set, before any module binds urlopen.
import os as _os  # noqa: E402
if _os.getenv('JOBADABRA_SEARCH_TAPE'):
    from . import search_tape as _search_tape  # noqa: E402
    _search_tape.install()
