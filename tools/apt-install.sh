#!/usr/bin/env bash
# CI: installs apt packages without ever hanging (owner, 25 Oct 2026: the "ffmpeg for the hero media tests" step sat 11m51s on web #122, normally 15-30 s: "that's way too much"
# ... "let's fix it"). apt itself retries a download 3 times and gives up on a silent mirror after 20 s; each try of `apt-get update` and `install` is cut by `timeout`;
# a failed try is repeated once; then the step fails at once and says why. Worst case about 5 minutes, never 12. Usage: tools/apt-install.sh <package>...
# The same script lives in the private site repo (tools/apt-install.sh); tests/test_ci_apt.py (here) fails when a workflow calls apt-get on its own.
set -uo pipefail
[ $# -gt 0 ] || { echo "apt-install: no packages named" >&2; exit 2; }
printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "20";' 'Acquire::https::Timeout "20";' 'DPkg::Lock::Timeout "60";' 'APT::Install-Recommends "false";' \
  | sudo tee /etc/apt/apt.conf.d/98ci-apt >/dev/null
cut() { timeout --kill-after=10 "$1" "${@:2}"; }   # a command, ended after $1 seconds
for attempt in 1 2; do
  if cut 45 sudo apt-get update -qq && cut 90 sudo apt-get install -y -qq "$@" >/dev/null; then
    echo "apt-install: $* ready (try $attempt)"; exit 0
  fi
  echo "apt-install: try $attempt stalled or failed, ${attempt}/2" >&2; sleep 5
done
echo "::error::apt-install: could not install $* after 2 tries, a package mirror stalled or is down; re-run the job" >&2
exit 1
