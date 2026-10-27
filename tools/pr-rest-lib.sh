#!/usr/bin/env bash
# Sourced by the loops that look at a PR again and again (tools/ship-watch.sh, tools/ship-pr.sh's wait): a PR's state, checks and comments over REST with conditional requests.
# Why (27 Oct 2026, the owner's 5,000-an-hour GraphQL budget ran out and PRs could not be opened): every look asked GitHub's GraphQL for the PR and its checks (a ship's wait
#   looked every 15 s, each watcher every 2 min). A REST read with the last ETag that comes back 304 costs nothing (measured: 1 full read + 3 conditional reads = 1 call).
#   The answers keep the shape of gh's own PR view and checks, so the callers keep their logic. The repo is always explicit: gh's PR commands read it from the working folder
#   and fail in a deleted worktree, so web #177's watcher never saw its merge. Guard: tests/test_pr_rest_lib.py.
# Why (owner, 27 Oct 2026, try 3 on "GraphQL runs out": "No GraphQL in our tools"): opening, editing, listing and labelling PRs and red-main issues are here too, over
#   REST; only what GitHub offers in GraphQL alone (a draft made ready, auto-merge) is left, and tools/bin/gh logs it with its session.

# Every gh of the tools that source this lib goes through tools/bin/gh, which logs a GraphQL call with its session (none should be left but a draft's ready and auto-merge).
_pr_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin"
case ":$PATH:" in *":$_pr_bin:"*) ;; *) [ -x "$_pr_bin/gh" ] && PATH="$_pr_bin:$PATH" ;; esac

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

# pr_view <repo> <n> [full]: the PR like `gh pr view --json number,url,title,state,mergeable,headRefOid,headRefName,mergeCommit` (state OPEN|MERGED|CLOSED,
# mergeable MERGEABLE|CONFLICTING|UNKNOWN). "full" adds comments, reviews and commits in the same shape (3 more reads, free while unchanged).
pr_view() {
  local p c r k
  p="$(pr_get "repos/$1/pulls/$2")" || return 1
  if [ "${3:-}" = full ]; then
    c="$(pr_get "repos/$1/issues/$2/comments?per_page=100")" && r="$(pr_get "repos/$1/pulls/$2/reviews?per_page=100")" && k="$(pr_get "repos/$1/pulls/$2/commits?per_page=100")" || return 1
  else c='[]'; r='[]'; k='[]'; fi
  printf '%s\n%s\n%s\n%s\n' "$p" "$c" "$r" "$k" | jq -sc '.[0] as $p | {number: $p.number, url: $p.html_url, title: $p.title, headRefOid: $p.head.sha, headRefName: $p.head.ref,
      state: (if $p.merged_at then "MERGED" elif $p.state == "closed" then "CLOSED" else "OPEN" end),
      mergeable: (if $p.mergeable == true then "MERGEABLE" elif $p.mergeable == false then "CONFLICTING" else "UNKNOWN" end),
      mergeCommit: (if $p.merged_at then {oid: $p.merge_commit_sha} else null end),
      comments: [.[1][]? | {id: .node_id, author: {login: (.user.login // "")}, body, url: .html_url, createdAt: .created_at}],
      reviews: [.[2][]? | {id: .node_id, author: {login: (.user.login // "")}, body, state, submittedAt: .submitted_at}],
      commits: [.[3][]? | {committedDate: .commit.committer.date}]}'
}

# pr_checks <repo> <sha>: the newest check-run of each name and every commit status of the sha like `gh pr checks --json name,bucket,link` (bucket pass|fail|pending|skipping|cancel).
# Why (#2282, its own first run): two edits of a PR start the same workflow twice and the first run is cancelled; the list keeps both, gh's checks keep only the newest.
pr_checks() {
  local runs st
  runs="$(pr_get "repos/$1/commits/$2/check-runs?per_page=100")" && st="$(pr_get "repos/$1/commits/$2/status")" || return 1
  printf '%s\n%s\n' "$runs" "$st" | jq -sc '[(.[0].check_runs // [] | group_by(.name) | map(max_by(.id))[] | {name, link: (.html_url // ""), bucket: (if .status != "completed" then "pending"
        elif (.conclusion | IN("success", "neutral")) then "pass" elif .conclusion == "skipped" then "skipping" elif .conclusion == "cancelled" then "cancel" else "fail" end)}),
      (.[1].statuses[]? | {name: .context, link: (.target_url // ""), bucket: (if .state == "success" then "pass" elif .state == "pending" then "pending" else "fail" end)})]'
}

# pr_list <repo> <state open|closed> [pages=1]: every PR of the state, 100 a page, newest first, as [{number, headRefName, headRefOid, merged}]. Each page is a conditional read.
pr_list() {
  local page=1 out all='[]'
  while [ "$page" -le "${3:-1}" ]; do
    out="$(pr_get "repos/$1/pulls?state=$2&per_page=100&page=$page")" || return 1
    all="$(jq -c --argjson a "$all" '$a + [.[] | {number, headRefName: .head.ref, headRefOid: .head.sha, merged: (.merged_at != null)}]' <<<"$out")" || return 1
    [ "$(jq length <<<"$out")" -eq 100 ] || break
    page=$((page + 1))
  done
  printf '%s\n' "$all"
}

# pr_of_head <repo> <branch>: the number of the open PR whose head is <branch> of <repo>'s owner; empty when there is none.
pr_of_head() { pr_get "repos/$1/pulls?state=open&head=${1%%/*}:$2&per_page=1" | jq -r '.[0].number // empty'; }

# pr_open <repo> <branch> <title> <body> [draft]: opens the PR into main; prints its URL.
pr_open() { gh api -X POST "repos/$1/pulls" -f base=main -f head="$2" -f title="$3" -f body="$4" ${5:+-F draft=true} --jq .html_url; }

# pr_set <repo> <n> <title|body> <text>: replaces the PR's title or description.
pr_set() { gh api -X PATCH "repos/$1/pulls/$2" -f "$3=$4" --jq .number >/dev/null; }

# pr_label <repo> <n> <label> <color> <description>: creates the label when the repo lacks it, then puts it on the PR.
pr_label() { gh api -X POST "repos/$1/labels" -f name="$3" -f color="$4" -f description="$5" >/dev/null 2>&1; gh api -X POST "repos/$1/issues/$2/labels" -f "labels[]=$3" >/dev/null; }

# pr_issues <repo> <label>: the open issues (never PRs) with that label, as [{number, title, body}].
pr_issues() { pr_get "repos/$1/issues?state=open&labels=$2&per_page=100" | jq -c '[.[] | select(.pull_request | not) | {number, title, body: (.body // "")}]'; }
