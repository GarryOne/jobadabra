#!/usr/bin/env bash
# Promote a desktop build to the stable release: friends' apps offer it as an update ("Update to …" in the menu),
# and the website's download links serve it. Every push to main only makes a pre-release.
#   tools/release-stable.sh                 # the newest build
#   tools/release-stable.sh desktop-v0.5.3
set -euo pipefail
repo=GarryOne/jobadabra
tag=${1:-$(gh release list -R "$repo" -L 20 --json tagName,isDraft -q '[.[] | select(.isDraft | not)][0].tagName')}

# The Windows installer must be THIS build's own. When the windows job fails, desktop.yml's mac-only fallback
# uploads the previous release's generic Jobadabra-/Job-Pilotto-windows-x64.exe, so the release looks promotable while its
# Windows app is an older version (30 Sep 2026: alpha.131-133 shipped that way). A generic name alone proves
# nothing; the versioned installer beside it, the same bytes, does.
version=${tag#desktop-v}
assets=$(gh release view "$tag" -R "$repo" --json assets -q '.assets[] | "\(.name)\t\(.size)"')
size_of() { printf '%s\n' "$assets" | awk -F'\t' -v want="$1" '$1 == want {print $2; exit}'; }
# Jobadabra-* are the names since 25 Oct 2026; a build before that (a rollback to 0.8.27) has only the Job-Pilotto-* ones, which is then the brand compared.
brand=Job-Pilotto; [ -z "$(size_of "Jobadabra-${version}-x64.exe")" ] || brand=Jobadabra
generic=$(size_of "${brand}-windows-x64.exe")
own=$(size_of "${brand}-${version}-x64.exe")
[ -n "$generic" ] || { echo "$tag has no Windows installer yet: wait for its build to finish." >&2; exit 1; }
[ -n "$own" ] || { echo "$tag carries no installer of its own (${brand}-${version}-x64.exe): its Windows build
failed and the previous release's installer was carried over. Promote a build whose Windows job passed." >&2; exit 1; }
[ "$own" = "$generic" ] || { echo "$tag's Windows installer is not the one its build made: ${brand}-${version}-x64.exe
is ${own} bytes, ${brand}-windows-x64.exe is ${generic}. Promote a build whose Windows job passed." >&2; exit 1; }

# The end-to-end journey (.github/workflows/e2e.yml: a new user through the wizard and every page, on a real Mac) must be green for THIS build's commit: it is the one
# gate on a release, and it runs here, not on every push. No usable run for the commit (none, or older than two days): this script starts one on the tag and waits for
# it (about 15 minutes), then decides by its result. E2E_NO_START=1 (the daily canary auto-promote, which cannot start a run) never starts one and accepts the newest
# run on main instead. SKIP_E2E=1 promotes anyway (a hotfix while the journey itself is broken): say why in the release notes.
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# E2E_ALREADY_GREEN=1: the promote job of e2e.yml, which runs after every suite of the nightly run passed on this build's commit (that run is still in progress, so it
# cannot be looked up; it is its own proof). DRY_RUN=1 prints what would happen and changes nothing.
sha=$(gh api "repos/$repo/commits/$tag" -q .sha)
# A manual promotion (the hot path) takes the beta's approval as the proof, for the SAME tag, version and build (owner, 12 Oct 2026: a beta approved on both platforms goes to stable as
# it is, with no fresh run; the canary and a staged rollout come with more installs). Both Beta-approved lines in the release notes must name this commit. FRESH_E2E=1 asks for a
# fresh end-to-end run as before; the daily auto-promote and the e2e promote job keep their own rules.
beta=none
if [ "${E2E_ALREADY_GREEN:-0}" != 1 ] && [ "${E2E_NO_START:-0}" != 1 ] && [ "${FRESH_E2E:-0}" != 1 ] && [ "${SKIP_E2E:-0}" != 1 ]; then
  beta=$(gh release view "$tag" -R "$repo" --json body -q .body | python3 "$here/e2e_gate.py" beta "$sha" || echo none)
fi
if [ "${E2E_ALREADY_GREEN:-0}" = 1 ]; then
  echo "End-to-end (Mac + Linux): green (the run that is promoting it)."
elif [ "$beta" = green ]; then
  echo "End-to-end: green, by the beta's approval of this exact build ($tag, commit ${sha:0:7}: Mac and Windows both approved it; no fresh run). FRESH_E2E=1 asks for one."
elif [ "${SKIP_E2E:-0}" != 1 ]; then
  mode=commit; branch=(); [ "${E2E_NO_START:-0}" = 1 ] && { mode=latest; branch=(--branch main); }
  gate() { gh run list -R "$repo" --workflow=e2e.yml ${branch[@]+"${branch[@]}"} --status completed -L 30 --json conclusion,headSha,createdAt | python3 "$here/e2e_gate.py" "$sha" "$mode"; }
  verdict=$(gate)
  if { [ "$verdict" = none ] || [ "$verdict" = stale ]; } && [ "${E2E_NO_START:-0}" != 1 ]; then
    echo "No fresh end-to-end run for $tag's commit (${sha:0:7}): starting one on the tag and waiting for it (about 15 minutes)..."
    started=$(date -u +%s)
    gh workflow run e2e.yml -R "$repo" --ref "$tag"
    id=""
    for _ in $(seq 1 40); do
      id=$(gh run list -R "$repo" --workflow=e2e.yml --event workflow_dispatch --commit "$sha" -L 5 --json databaseId,createdAt \
        -q "[.[] | select((.createdAt | fromdateiso8601) >= $((started - 5)))][0].databaseId // empty")
      [ -n "$id" ] && break
      sleep "${E2E_POLL_SECONDS:-5}"
    done
    [ -n "$id" ] || { echo "The end-to-end run did not appear on GitHub: look at gh run list --workflow=e2e.yml -R $repo, then run this again." >&2; exit 1; }
    echo "Watching run $id: https://github.com/$repo/actions/runs/$id"
    gh run watch "$id" -R "$repo" --exit-status > /dev/null || true   # its result is read back below, by the same rule as any other run
    verdict=$(gate)
  fi
  case "$verdict" in
    green) echo "End-to-end (Mac + Linux): green." ;;
    none) echo "No finished end-to-end run for this build yet. Run it: gh workflow run e2e.yml -R $repo --ref $tag (about 15 minutes), then promote. SKIP_E2E=1 overrides." >&2; exit 1 ;;
    stale) echo "The last green end-to-end run is over two days old. Run it again: gh workflow run e2e.yml -R $repo. SKIP_E2E=1 overrides." >&2; exit 1 ;;
    red*) echo "The end-to-end journey is RED (${verdict#red }): a new user would not get through the app. Fix it, or SKIP_E2E=1 to promote anyway." >&2; exit 1 ;;
  esac
fi

if [ "${DRY_RUN:-0}" = 1 ]; then echo "Dry run: would make $tag stable (its Windows installer is its own, the end-to-end gate holds)."; exit 0; fi
was_beta=$(gh release view "$tag" -R "$repo" --json isPrerelease -q .isPrerelease 2>/dev/null || echo true)
gh release edit "$tag" -R "$repo" --prerelease=false --latest
echo "Stable: $tag (friends' apps offer it within 10 minutes, or at their next start)"
# Why (1 Nov 2026, owner: "I'd like to receive on Telegram, CI Alerts, when a new version (beta or stable) is released"): one Telegram alert on EVERY way a release becomes stable (all of them end here),
# only when this run made it stable: a re-run on a tag that already is stable says nothing. A failed alert never hides or undoes the promotion.
if [ "$was_beta" = true ]; then GITHUB_REPOSITORY="$repo" node "$here/../desktop/e2e/release-alert.mjs" stable "$tag" || echo "(release alert not sent)" >&2; fi
# Both store publishes start on EVERY way a release becomes stable (the daily canary, the release run, beta-approve with the soak off, the hot path): the switches above
# (SKIP_E2E, E2E_NO_START, ...) only skip the end-to-end gate, and only DRY_RUN stops before this point. A start that fails never undoes the promotion, but it is no longer one echoed line
# in a green run. Why (31 Oct 2026, owner: "We should have this always, even if we go on the hot path"): the job ends red (exit 4 below), with an annotation and one Telegram alert.
failed=(); by_hand=()
start_store() {   # <store name> <workflow file> <what it does>
  local command="gh workflow run $2 -R $repo --ref main -f tag=$tag"
  if gh workflow run "$2" -R "$repo" --ref main -f tag="$tag"; then echo "$1: $3"
  else
    failed+=("$1"); by_hand+=("$command")
    echo "::error title=$1 publish not started::$tag is stable, but its $1 publish did not start. Start it by hand: $command"
  fi
}
start_store "Chrome Web Store" extension-store-publish.yml "publishing its extension (Extension · Chrome Web Store publish; the store reviews it, then Chrome updates every copy)"
start_store "Microsoft Store" msix-store.yml "building and submitting its Windows package (Build · Windows Store package; Microsoft certifies it, then the Store updates every copy)"
python3 "$here/sync_release_labels.py" || echo "(release labels not refreshed: run tools/sync_release_labels.py)"   # the list says STABLE / BETA / Build; best effort, never fails a promotion
if [ "${#failed[@]}" -gt 0 ]; then
  names=$(printf '%s, ' "${failed[@]}"); names=${names%, }
  message="⚠️ $tag is stable, but the publish to the $names did not start. Start it by hand:"
  for command in "${by_hand[@]}"; do message+=$'\n'"$command"; done
  message+=$'\n'"Run: ${GITHUB_SERVER_URL:-https://github.com}/$repo/actions/runs/${GITHUB_RUN_ID:-0}"
  # The one alert path the other CI checks use (desktop/e2e/ci-alert.mjs; CI_ALERTS_TELEGRAM_BOT_TOKEN and _CHAT_ID from the calling step); an alert that cannot go out never hides the failure.
  MESSAGE="$message" node --input-type=module -e "import {send} from '$here/../desktop/e2e/ci-alert.mjs'; console.log(await send(process.env.MESSAGE))" || echo "(alert not sent)" >&2
  echo "$tag is stable, but the $names publish did not start: this run ends red (exit 4) so it is seen. Start it by hand, as above." >&2
  exit 4
fi
