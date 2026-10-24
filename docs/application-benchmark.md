# Application-form accuracy benchmark

Measure the form left **unsubmitted** for applicant review. The Claude/Codex tab checkmark is a
completion cue, not evidence that fields are correct. The Terminal Codex run report is also an
agent observation; a human reviewer supplies independent correctness flags.

1. Choose at least one real application form each on Greenhouse, Ashby and Lever; add Workday when
   the account/login step can be completed by the owner. Prefer roles already in Jobadabra with
   saved kits. Do not click Submit or check legal agreements during the benchmark.
2. Start one run at a time with `tools/apply-batch-codex-terminal.sh <job URL>`. Capture elapsed
   wall time and Codex usage shown by the account, if available. The runner saves its trace and
   checklist privately under `~/Library/Application Support/JobPilotto/apply-runs/`.
3. Independently inspect **every** visible form field and attachment in the browser. Record only
   the field label and whether its value matches the CV/Profile/Application Answers/kit; do not
   copy applicant values or screenshots into the repo. Keep a private JSON file outside the repo:

   ```json
   {
     "cases": [
       {
         "url": "https://example.invalid/job/123",
         "ats": "Greenhouse",
         "submitted": false,
         "reviewed_fields": [
           {"label": "Email", "correct": true},
           {"label": "Work authorization", "correct": false}
         ]
       }
     ]
   }
   ```

4. Run `python3 tools/benchmark-apply-runs.py /private/path/reviews.json`. It reports field
   coverage, correctness, false agent claims, active fill time and results by ATS. It rejects
   submitted cases and, by default, requires three distinct ATSs. Record which fields the
   deterministic helper filled and which needed agent judgment before choosing a default.

This harness makes no model calls and has no service fee. Real form runs can consume Codex usage;
do not launch a benchmark batch until the owner approves the expected usage. The metrics describe
these reviewed forms only; they are not a general success-rate claim.
