#!/bin/bash
# npm run live: the site limit first (live-check.mjs), then the heavy lock, then the row (live.mjs).
# Job: run the backbone
node "$(dirname "$0")/live-check.mjs" "$@" || exit $?
JOBADABRA_HEAVY_CLASS=proof exec bash "$(dirname "$0")/../../tools/heavy-lock.sh" e2e-smoke node "$(dirname "$0")/live.mjs" "$@"
