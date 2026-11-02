#!/bin/sh
# Keeps every repo of the jobadabra org on the same setup: files, settings, ruleset, weekly check (tools/org_repo.py has the usage; skill onboard-org-repo).
exec python3 "$(dirname "$0")/org_repo.py" "$@"
