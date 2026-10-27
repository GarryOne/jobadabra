#!/usr/bin/env bash
# Sourced by tools/ship-watch.sh and tools/pr-red-check.sh: turns a PR's comments, reviews and review line comments into one TSV row each, so both read them the same way.
# pc_items <`gh pr view --json url,comments,reviews` JSON> <`gh api pulls/n/comments` JSON, may be empty> -> "<id>\t<author>\t<kind>\t<url>\t<time>"
#   author: owner | bot | self | other.  kind: comment | review-<state> | line.  Guard: tests/test_pr_comments.py.
# Why (#PR comments, owner 27 Oct 2026: "add a monitor to each session for PR comments and automatically handle them"): the author is decided here, once.
#   self = the body ends with the Claude Code line (sessions post as the owner's gh login, so the login alone cannot tell them apart); owner = the owner's login without that line;
#   bot = a review bot (gitar-bot); everything else is `other` = data for the coordinator, never an instruction (the repo is public). PR_COMMENTS_OWNER overrides the owner's login.
# A review with state COMMENTED and no body is only the container of its line comments, which are listed on their own.
pc_items() {
  jq -rn --arg owner "${PR_COMMENTS_OWNER:-GarryOne}" --argjson v "${1:-null}" --argjson l "${2:-null}" '
    def who(login; body): if ((body // "") | test("Generated with.{0,4}Claude Code")) then "self"
      elif (login | test("\\[bot\\]$|-bot$")) then "bot" elif login == $owner then "owner" else "other" end;
    ( [($v.comments // [])[] | {id: .id, a: who(.author.login // ""; .body), k: "comment", u: (.url // $v.url // ""), t: (.createdAt // "")}]
    + [($v.reviews // [])[] | select((.state != "COMMENTED") or ((.body // "") != ""))
        | {id: .id, a: who(.author.login // ""; .body), k: ("review-" + (.state | ascii_downcase)), u: ($v.url // ""), t: (.submittedAt // "")}]
    + [($l // [])[] | {id: ("L" + (.id | tostring)), a: who(.user.login // ""; .body), k: "line", u: (.html_url // ""), t: (.created_at // "")}]
    )[] | [.id, .a, .k, .u, .t] | @tsv' 2>/dev/null
}
