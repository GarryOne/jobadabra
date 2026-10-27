#!/usr/bin/env bash
# Sourced by the loops that look at a PR again and again (tools/ship-watch.sh, tools/ship-pr.sh's wait): a PR's state, checks and comments over REST with conditional requests.
# Why (27 Oct 2026, the owner's 5,000-an-hour GraphQL budget ran out and PRs could not be opened): every look asked GitHub's GraphQL for the PR and its checks (a ship's wait
#   looked every 15 s, each watcher every 2 min). A REST read with the last ETag that comes back 304 costs nothing (measured: 1 full read + 3 conditional reads = 1 call).
#   The answers keep the shape of gh's own PR view and checks, so the callers keep their logic. The repo is always explicit: gh's PR commands read it from the working folder
#   and fail in a deleted worktree, so web #177's watcher never saw its merge. Guard: tests/test_pr_rest_lib.py.

# pr_repo [dir]: "owner/repo" of the dir's origin when it is on GitHub, read from git (no network); empty otherwise.
pr_repo() { git -C "${1:-.}" remote get-url origin 2>/dev/null | sed -nE 's#^(git@github\.com:|ssh://git@github\.com/|https://github\.com/)([^/]+/[^/]+)$#\2#p' | sed -E 's#\.git$##'; }

# pr_get <api path>: the JSON body. Sends the last ETag; a 304 answers from the cache (PR_REST_CACHE, default a folder in TMPDIR), free of the rate limit.
# Fails with no output when GitHub refuses (rate limit, 404) or cannot be reached. The cache file (ETag line, then the body) is replaced whole by a rename.
pr_get() {
  local dir="${PR_REST_CACHE:-${TMPDIR:-/tmp}/pr-rest-cache}" key etag out code h=()
  mkdir -p "$dir" 2>/dev/null || return 1
  key="$dir/$(printf '%s' "$1" | tr -c 'A-Za-z0-9' _)"
  etag="$(head -n 1 "$key" 2>/dev/null)"; [ -z "$etag" ] || h=(-H "If-None-Match: $etag")
  out="$(gh api -i ${h[@]+"${h[@]}"} "$1" 2>/dev/null | tr -d '\r')"   # gh exits 1 on a 304: the status line decides
  code="$(head -n 1 <<<"$out" | awk '{print $2}')"
  case "$code" in
    304) [ -n "$etag" ] && tail -n +2 "$key" ;;
    200) etag="$(sed -n 's/^[Ee][Tt][Aa][Gg]: //p' <<<"$out" | head -n 1)"
         out="$(awk 'body {print} !body && $0 == "" {body = 1}' <<<"$out")"
         [ -n "$out" ] || return 1
         { printf '%s\n' "$etag"; printf '%s\n' "$out"; } > "$key.$$" && mv -f "$key.$$" "$key"
         printf '%s\n' "$out" ;;
    *) return 1 ;;
  esac
}

# pr_view <repo> <n> [full]: the PR like `gh pr view --json number,url,state,mergeable,headRefOid,headRefName,mergeCommit` (state OPEN|MERGED|CLOSED,
# mergeable MERGEABLE|CONFLICTING|UNKNOWN). "full" adds comments, reviews and commits in the same shape (3 more reads, free while unchanged).
pr_view() {
  local p c r k
  p="$(pr_get "repos/$1/pulls/$2")" || return 1
  if [ "${3:-}" = full ]; then
    c="$(pr_get "repos/$1/issues/$2/comments?per_page=100")" && r="$(pr_get "repos/$1/pulls/$2/reviews?per_page=100")" && k="$(pr_get "repos/$1/pulls/$2/commits?per_page=100")" || return 1
  else c='[]'; r='[]'; k='[]'; fi
  printf '%s\n%s\n%s\n%s\n' "$p" "$c" "$r" "$k" | jq -sc '.[0] as $p | {number: $p.number, url: $p.html_url, headRefOid: $p.head.sha, headRefName: $p.head.ref,
      state: (if $p.merged_at then "MERGED" elif $p.state == "closed" then "CLOSED" else "OPEN" end),
      mergeable: (if $p.mergeable == true then "MERGEABLE" elif $p.mergeable == false then "CONFLICTING" else "UNKNOWN" end),
      mergeCommit: (if $p.merged_at then {oid: $p.merge_commit_sha} else null end),
      comments: [.[1][]? | {id: .node_id, author: {login: (.user.login // "")}, body, url: .html_url, createdAt: .created_at}],
      reviews: [.[2][]? | {id: .node_id, author: {login: (.user.login // "")}, body, state, submittedAt: .submitted_at}],
      commits: [.[3][]? | {committedDate: .commit.committer.date}]}'
}

# pr_checks <repo> <sha>: every check-run and commit status of the sha like `gh pr checks --json name,bucket,link` (bucket pass|fail|pending|skipping|cancel).
pr_checks() {
  local runs st
  runs="$(pr_get "repos/$1/commits/$2/check-runs?per_page=100")" && st="$(pr_get "repos/$1/commits/$2/status")" || return 1
  printf '%s\n%s\n' "$runs" "$st" | jq -sc '[(.[0].check_runs[]? | {name, link: (.html_url // ""), bucket: (if .status != "completed" then "pending"
        elif (.conclusion | IN("success", "neutral")) then "pass" elif .conclusion == "skipped" then "skipping" elif .conclusion == "cancelled" then "cancel" else "fail" end)}),
      (.[1].statuses[]? | {name: .context, link: (.target_url // ""), bucket: (if .state == "success" then "pass" elif .state == "pending" then "pending" else "fail" end)})]'
}
