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
# pc_last_authored <pr view JSON> -> newest commit authored time, or empty when none; never fall back to a rebase's committed time.
#   An answer is a NEW commit or a session reply: an amended/squashed commit keeps its old authored date and looks like a rebase (Gitar on #2578, tests/test_pr_comments.py `amended`).
pc_last_authored() {
  jq -r '[.commits[]?.authoredDate // empty] | max // ""' <<<"$1"
}
# pc_unanswered <last commit time, may be empty> < pc_items rows -> the rows of owner/bot/other still waiting for a reply
# Why (#PR comments, owner 27 Oct 2026): an item is answered when a session comment or a commit's authored time is newer than it (ISO times compare as text). One copy, read by tools/pr-red-check.sh (what to remind)
#   and tools/ship-watch.sh (what a watcher that starts on an old PR may announce), so a comment already answered hours ago is never reported again.
pc_unanswered() {
  awk -F'\t' -v last="${1:-}" '$2=="self" && $5>last {last=$5} {r[NR]=$0} END {for (i=1;i<=NR;i++) {split(r[i],f,"\t"); if (f[2]!="self" && f[5]>=last) print r[i]}}'
}

# pc_gitar_summary <view JSON> <comment id> -> verdict + open finding count, or empty for an unrecognized comment.
# Invariant: only Gitar's Code Review summary is comparable; ordinary bot and owner comments are never suppressed.
pc_gitar_summary() {
  jq -r --arg id "$2" '
    .comments[]? | select(.id == $id and (.author.login | IN("gitar-bot", "gitar-bot[bot]"))) | .body
    | capture("<summary><b>Code Review</b>\\s*<kbd>(?<verdict>[^<]*)</kbd>(?<counts>[^\\n]*?)</summary>")?
    | (.verdict | ascii_downcase) as $v
    | (if $v | contains("changes requested") then "changes" elif $v | contains("approved with suggestions") then "suggestions"
       elif $v | contains("approved") then "approved" else empty end) as $verdict
    | ((.counts | capture("(?<closed>[0-9]+) closed / (?<total>[0-9]+) findings?")?) // (if $verdict == "approved" then {closed: "0", total: "0"} else empty end))
    | select((.total | tonumber) >= (.closed | tonumber))
    | "\($verdict):\((.total | tonumber) - (.closed | tonumber))"' <<<"$1"
}
