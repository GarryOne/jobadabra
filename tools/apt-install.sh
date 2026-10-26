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
# The second try uses Ubuntu's own archive instead of the runner's Azure mirror (26 Oct 2026: web #154 failed 3 times in a row on a stalled
# mirror, 16:13-16:22): a mirror that is down stays down for minutes, so the same mirror again rarely helps.
apt_dir="${APT_DIR:-/etc/apt}"   # tests point it at a folder of their own
other_mirror() {
  for file in "$apt_dir"/sources.list "$apt_dir"/sources.list.d/*.sources; do
    [ -f "$file" ] && sudo perl -pi -e 's#https?://azure\.archive\.ubuntu\.com#http://archive.ubuntu.com#g' "$file"
  done
  echo "apt-install: try 2 on archive.ubuntu.com" >&2
}
for attempt in 1 2; do
  [ "$attempt" = 2 ] && other_mirror
  if cut 45 sudo apt-get update -qq && cut 90 sudo apt-get install -y -qq "$@" >/dev/null; then
    echo "apt-install: $* ready (try $attempt)"; exit 0
  fi
  echo "apt-install: try $attempt stalled or failed, ${attempt}/2" >&2; sleep 5
done
echo "::error::apt-install: could not install $* after 2 tries, a package mirror stalled or is down; re-run the job" >&2
exit 1
