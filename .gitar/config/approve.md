Approve only if the code review has no unresolved finding of any severity (a suggestion still open counts).

Why (28 Oct 2026, #2404): the approval step sees the PR's metadata, changed files and review results, not its description. The earlier criteria
(root cause, Design block, who gets what) were checked against the description, so every PR was withheld ("Skip: the PR body and any AREA-CIRCLES
line are not in the provided metadata"). Those checks live in the review rules (.gitar/review/), which read the description and raise blocking
findings; this file only asks that none is left.
