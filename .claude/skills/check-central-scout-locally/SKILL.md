---
name: check-central-scout-locally
description: Check a change to the central scout (src/scout*.py, central-scout.yml, the lab discovery) in seconds on this Mac before it ships, then read the CI run's log for the lines that prove it worked. Use before shipping any scout change, when a scout run "published but X did not happen", or when the owner asks "did the scout run do it".
---

# Check the central scout locally (seconds), then read the run (minutes)

Why: 24 Oct 2026 the board pass was merged without its path ever running. The first look was a 27-minute CI run (6-hourly schedule): it skipped the pass **silently**
(the feed checks used all the time), and the first fix used a name before its import. A run is slow and costs AI; the same path runs in under a second with fakes.

## 1. Before shipping (seconds, $0)
- `python3 -m unittest tests.test_scout_publish_path tests.test_scout_boards tests.test_scout_central_runs tests.test_scout_cells`
- `tests/test_scout_publish_path.py` drives `scout.main --publish-index` with every network piece replaced (the checks, the board pass, the publish) and the job
  "20 minutes in", so a slow run's deadlines are real. A new step in that branch gets a fake in `run_main` and an assertion in this test, not only its own unit test.
- **Watch the new assertion fail on the old code** (revert the fix by hand, run, restore), as for any bug.
- A real local run (`python3 -m src scout --batch 3 --publish-index` with temp `JOB_PILOTTO_DATA_DIR` / `CONFIG_DIR` and a stub index URL) is NOT a smoke:
  candidate gathering alone (Wikidata, Common Crawl) takes minutes and 504s, so it never reaches the publish. Use the test above.

## 2. After it merges: read the run, don't wait for it blind
- Dispatch needs the owner's yes with the cost (a run is about $0.17 of AI). Otherwise the next scheduled run (04:20, 10:20, 16:20, 22:20 UTC; GitHub often starts late).
- `gh run list --repo GarryOne/jobadabra --workflow central-scout.yml -L 3`, then `gh run view <id> --repo GarryOne/jobadabra --log > <scratchpad>/run.log`
  (the run's code is the branch at its start: `gh run view <id> --json headSha`, `git merge-base --is-ancestor <your sha> <headSha>`; a run that started before your merge proves nothing).
- Lines to read (grep): `Board pass:` or `Board pass skipped:` (never silent), `Employers with local jobs by country`, `Feeds by system`, `Published N feeds`,
  `AI cost of this scout run`, Common Crawl `<system>: N boards` / `HTTP 504`, and `Scout: <phase> took N s` for where the time went.
- Arm a Monitor on the run id (status poll until completed, then the grep), never a blind wait. The run ends ~27 min after it starts.

## 3. Report
One message to the coordinator and to the session that builds on it (jobadabra-fc reads `board_facts`): the lines above, what is still 0 and why, and whether the run
included the change (the sha check). A silent skip is a bug to fix in the same change, with the line that would have said so.
