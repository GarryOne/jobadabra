#!/usr/bin/env bash
# After ship.sh opens or pushes a lab PR, asks the public repo to run the lab's tests on it (a lab PR cannot start a public workflow); never fails a ship.
# Usage: tools/lab-ci-dispatch.sh <lab PR number>   Guarded by tests/test_lab_ci.py.
n="${1:-}"; [ -n "$n" ] || exit 0
repo="$(. "$(dirname "$0")/pr-rest-lib.sh" && pr_repo .)"   # from git, no GitHub call (try 3 on "GraphQL runs out", 27 Oct 2026)
case "$repo" in */jobadabra-lab) ;; *) exit 0 ;; esac
gh workflow run lab-ci.yml -R GarryOne/jobadabra -f pr="$n" >/dev/null 2>&1 && echo "ship: lab-ci requested for #$n (result: status 'lab-ci' on the PR)" || echo "ship: could not request lab-ci for #$n (the 20-minute sweep will run it)"
exit 0
