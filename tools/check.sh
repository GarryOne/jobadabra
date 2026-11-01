#!/usr/bin/env bash
# Every agent uses this entry point; select a supported Python, then let check.py select Node and run CI checks.
set -eu
repo="$(cd "$(dirname "$0")/.." && pwd)"
for candidate in "${JOBADABRA_CHECK_PYTHON:-}" python3.12 python3.13 python3.14 python3 python; do
  [ -n "$candidate" ] || continue
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 12))' >/dev/null 2>&1; then
    exec "$candidate" "$repo/tools/check.py" "$@"
  fi
done
echo 'check: Python 3.12+ is required. Install it or set JOBADABRA_CHECK_PYTHON to its executable.' >&2
exit 2
