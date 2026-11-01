#!/usr/bin/env bash
# The pool's newest network records, decrypted on the CI runner only (the Mac's on the release net-records of the PRIVATE repo jobadabra-lab (owner, 14 Oct 2026),
# read with NET_RECORDS_READ_TOKEN, the public repo's old release as a fallback; records-publish.mjs): bash net-records-fetch.sh <records dir>.
# ONLY the published release is read (owner, 15 Oct 2026): a record-sites run's CI artifact (net-records-<run>) is never fetched, so a recording reaches a replay only after it passed records-publish's guard. Needs NET_RECORD_KEY, GH_TOKEN and NET_RECORDS_READ_TOKEN on CI; on the Mac none (the Keychain key, the gh login). Used by site-replays-pr.yml and site-replays.yml.
# --bundles-only <dir>: only downloads the release's bundles into <dir>, STILL ENCRYPTED (no key needed, nothing decrypted): one job per workflow run does it and uploads <dir> as an artifact, and every replay job
# sets NET_RECORDS_BUNDLES=<that artifact's folder> and so makes no release call (15 Oct 2026: ~20 jobs each downloading dozens of assets tripped GitHub's burst limit for every session).
set -u
bundles_only=0; [ "${1:-}" = "--bundles-only" ] && { bundles_only=1; shift; }
out="${1:?usage: net-records-fetch.sh [--bundles-only] <records dir>}"
# Each run its own private folder, removed on any exit: two sessions fetching at once on the Mac shared /tmp/enc and /tmp/key.pem (15 Oct 2026), and an aborted run left the key behind.
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/net-records.XXXXXX")"; trap 'rm -rf "$work"' EXIT
enc="$work/enc"; key="$work/key.pem"
mkdir -p "$out" "$enc"
# On the Mac the private repo is read with the person's own gh login when no read token is given (new sessions stopped at "no Mac records", 15 Oct 2026); CI passes its token.
[ -z "${NET_RECORDS_READ_TOKEN:-}" ] && [ -z "${CI:-}" ] && NET_RECORDS_READ_TOKEN="$(gh auth token 2>/dev/null || true)"
# ...and the private key from the Keychain item jobadabra.capture.key (base64 of the PEM, as NET_RECORD_KEY), read here and never printed; it lives only in $work.
[ -z "${NET_RECORD_KEY:-}" ] && [ -z "${CI:-}" ] && command -v security >/dev/null && NET_RECORD_KEY="$(security find-generic-password -s jobadabra.capture.key -w 2>/dev/null || true)"
umask 077 && printf '%s' "${NET_RECORD_KEY:-}" | base64 -d > "$key"   # unset in --bundles-only: nothing is decrypted there
# gh release download with a retry on GitHub's own rate limit (19:06Z, 16 Oct 2026: the read token belongs to the owner's account, so every session's gh calls and every CI fetch drew on one
# 5,000/h and the PR journeys went red as "no record"). A rate limit waits 20 s then 60 s (NET_RECORDS_RETRY_SLEEP="20 60"), then says RATE LIMITED, never "no record". $1 token (may be empty), rest: gh args.
# 17 Oct 2026: bursts of PR runs reading the release at once were answered "release not found" (a 404 for the private repo, not a missing release) and the fetch gave up at once, failing "Site replays ·
# PR / bundles" repo-wide. With a read token, a 404, a 403, a 5xx or a rate-limit wording are all GitHub pushing back: waits 20 s, 60 s, 120 s (NET_RECORDS_RETRY_SLEEP), every answer is kept and shown.
# $1 token (may be empty), $2 label for the log, rest: gh args. The tokenless fallback (the public repo, which has no such release) is tried once.
gh_get() {
  local token="$1" label="$2" pause; shift 2
  for pause in ${NET_RECORDS_RETRY_SLEEP:-20 60 120} stop; do
    : > "$work/try.err"
    if GH_TOKEN="${token:-${GH_TOKEN:-}}" gh release download net-records "$@" --pattern 'net-records*' --dir "$enc/mac" >/dev/null 2>"$work/try.err"; then return 0; fi
    echo "$label: $(head -n 1 "$work/try.err" | cut -c1-200)" >> "$work/gh.err"
    [ -n "$token" ] && grep -qiE 'rate limit|release not found|HTTP (403|404|429|5[0-9][0-9])|abuse|secondary|timed? ?out|temporar' "$work/try.err" || { grep -qi 'rate limit' "$work/try.err" && touch "$work/rate-limited"; return 1; }
    touch "$work/burst"
    grep -qi 'rate limit' "$work/try.err" && touch "$work/rate-limited"
    [ "$pause" = stop ] && return 1
    if grep -qi 'rate limit' "$work/try.err"; then echo "net-records-fetch: rate limited by GitHub (the token's account hourly limit, shared with every other use of it): retrying in ${pause}s" >&2
    else echo "net-records-fetch: GitHub pushed back on the read ($(head -n 1 "$work/try.err" | cut -c1-120)): retrying in ${pause}s" >&2; fi
    sleep "$pause"
  done
  return 1
}
mac_records() {   # the run's shared bundles when given (no gh call); else the private repo first (its read-only token), then this repo's old public release
  if [ -n "${NET_RECORDS_BUNDLES:-}" ] && ls "$NET_RECORDS_BUNDLES"/net-records*.k.enc >/dev/null 2>&1; then
    mkdir -p "$enc/mac" && cp "$NET_RECORDS_BUNDLES"/net-records* "$enc/mac/" && { echo "net-records-fetch: Mac records from the run's shared bundles"; return 0; }
  fi
  echo "net-records-fetch: read token: $([ -n "${NET_RECORDS_READ_TOKEN:-}" ] && echo set || echo EMPTY) (the private repo is read with it; without it only this repo's own release is tried)" >&2
  [ -n "${NET_RECORDS_READ_TOKEN:-}" ] && gh_get "$NET_RECORDS_READ_TOKEN" "${NET_RECORDS_REPO:-GarryOne/jobadabra-lab}" -R "${NET_RECORDS_REPO:-GarryOne/jobadabra-lab}" && { echo "net-records-fetch: Mac records from ${NET_RECORDS_REPO:-GarryOne/jobadabra-lab}"; return 0; }
  gh_get "" "${GITHUB_REPOSITORY:-this repo}" && { echo "net-records-fetch: Mac records from this repo's release (fallback)"; return 0; }
  echo "net-records-fetch: no Mac records"; return 1
}
# every bundle on the release (records-publish.mjs adds one per publish; the first set is net-records.tgz.enc): each into mac/<bundle> (whereOf reads the mac/ folder), the newest record per row wins
if mac_records; then
  if [ "$bundles_only" = 1 ]; then
    cp "$enc"/mac/net-records* "$out"/ && echo "net-records-fetch: $(ls "$out" | wc -l | tr -d ' ') bundle files kept encrypted in the folder" && exit 0
  fi
  for k in "$enc"/mac/net-records*.k.enc; do
    [ -f "$k" ] || continue
    name="$(basename "$k" .k.enc)"
    openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -in "$k" -out "$enc/k" \
      && mkdir -p "$out/mac/$name" && openssl enc -d -aes-256-cbc -pbkdf2 -in "$enc/mac/$name.tgz.enc" -pass "file:$enc/k" | tar xz -C "$out/mac/$name" || true
    rm -f "$enc/k"
  done
fi
count="$(find "$out" -name record.json | wc -l | tr -d ' ')"
echo "net-records-fetch: $count records"
# Nothing fetched is a failure, never an empty set for a gate to judge (15 Oct 2026: gh failed, its error went to /dev/null and the gate called all 16 pinned rows "worse: no result"). gh's own words are shown.
if [ "$count" = 0 ]; then
  if [ -e "$work/rate-limited" ]; then echo "net-records-fetch: FAILED: RATE LIMITED: GitHub's API limit for the read token's account is used up; the records are there, this is not a missing record (gh said:)" >&2
  elif [ -e "$work/burst" ]; then echo "net-records-fetch: FAILED: BURST-LIMITED: GitHub refused the read after every wait (20/60/120 s); the records are there, this is not a missing record. Every answer, in order (gh said:)" >&2
  elif [ -z "${NET_RECORDS_READ_TOKEN:-}" ]; then echo "net-records-fetch: FAILED: the read token is EMPTY in this run (the secret was not given), so the private release cannot be seen (gh said:)" >&2
  else echo "net-records-fetch: FAILED: no record fetched (gh said:)" >&2; fi
  tail -n 12 "$work/gh.err" >&2 2>/dev/null || true
  exit 1
fi
