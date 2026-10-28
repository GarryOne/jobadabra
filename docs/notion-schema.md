# Notion schema reference

Exact property names and types this project reads and writes, so you can create your own copies
from scratch rather than guessing from the source code. Create each as a **database** (unless
marked "page"), share it with your Notion integration, and set its ID via the matching environment
variable (see the main README's Configuration section) — property names must match exactly.

## Job Tracker (database)

Env var: `NOTION_APPLICATIONS_DB`. One row per opportunity: applied, saved or inbound. Formerly "Applications — Job Tracker" (the app renames it; it finds either title).

- **Outbound or inbound**: the **Origin** column (`src/notion/origin.py`, `desktop/renderer/origin.js`)
  - Set once at creation: recruiter contact = Inbound; match, kit, apply, saved, applied elsewhere = Outbound
  - Never overwritten; change it by hand in Notion (e.g. saved before a recruiter wrote)
  - Empty (older rows) → derived; the app fills it once at start-up (`python -m src.notion.origin --backfill [--apply]`)
  - Derived rule: Inbound = Stage or event `Recruiter lead`, Notes `Recruiter message (…)`, or Source `LinkedIn` / `Phone`
  - Outbound: the rest; Notes `Logged from a paste (…)` (applied elsewhere) and an empty Source included
  - Funnel: outbound only; inbound in its own Focus card (Inbound funnel)
- **Inbound title**: `Role · Company`, else `Role · via Agency` (Job column, `src/notion/titles.py`); outbound = role only
**Rule:** every job you pursue has one Applications row, found or added (by hand, `/add`, a recruiter's LinkedIn/email message); a job you add gets its facts and fit score here (Fit score, Tier, Seniority, Work mode, Recruiter, Salary), never a Job Matches row.

| Property | Type | Notes |
|---|---|---|
| Job | Title | The role. Inbound rows also name who it is for: `Principal SRE · Acme`, or `Principal SRE · via Huxley` while the employer is unknown (`src/notion/titles.py`; updated once the employer is known, never over your own edit). Outbound rows: the role only (Company says the employer) |
| Company | Text | |
| Location | Text | |
| Job URL | URL | Canonical posting URL — the match key everything uses |
| Stage | Select | Options: `Kit ready` (a kit was drafted automatically), `Saved` (you tapped ⭐), `Applying`, `Applied`, `Confirmation received`, `Screening`, `Interview scheduled`, `Interviewing`, `Offer`, `Rejected`, `Withdrawn`, `No response`, `Dismissed`, `Closed` (posting gone) |
| Source | Select | Where the contact started: `LinkedIn`, `Gmail` (an email), `Phone` (a call, as confirmed in the app's Log box), else how the row was added (`Telegram`, `Manual`, `Jobadabra app`). A later channel never replaces it; something logged later but dated before the first contact does |
| Applied on | Date | Set when Stage becomes Applied |
| Posted | Date | Posting date from the source, or first-seen date if unknown |
| Next interview | Date | Set by the Gmail check or by you; cleared once the interview is reviewed or confirmed held |
| Next step | Text | Yours to edit; an interview review sets it to what the call said happens next |
| Form fill time (min) | Number | Active AI form-filling minutes, written at the ready-for-review handoff |
| Kit cost (USD) | Number (dollar) | Anthropic API cost of drafting this job's kit, written when it's drafted |
| Notes | Text | You fill this in manually |
| Salary | Text | You fill this in manually |
| Contact | Text | You fill this in manually |
| Confirmation email | Checkbox | You fill this in manually |

Frozen when the job is marked Applied (`src/notion/ledger.py`), for learning which applications get
replies:

| Property | Type | Notes |
|---|---|---|
| Recorded | Date | When the application record was frozen |
| Fit score | Number | AI stage 2 score at the time |
| Tier | Select | `A`, `B`, `C` |
| Seniority | Select | Same options as Job Matches |
| Work mode | Select | `On-site`, `Hybrid`, `Remote` |
| Recruiter | Checkbox | |
| ATS | Select | `Greenhouse`, `Ashby`, `Lever`, `Workable`, `Other` |
| Agent | Select | `Claude`, `Codex`, `ChatGPT`, `Manual` (from the local form-filling run record) |
| Days to apply | Number | Days from Posted to Applied on |
| Cover letter | Checkbox | |
| Questions | Number | Questions answered |
| Answers captured | Select | `Form` (read from the page just before Submit), `Kit draft`, `None` |
| CV version | Text | File name and a short content hash |
| Kit variant | Text | Kit prompt variant, for experiments |
| Channel | Select | `Direct`, `Recruiter platform`, `Agency`, `Referral` — how you applied; set from the URL when empty |
| Via | Text | Recruiter platform or agency, e.g. TechTree; Company holds the real employer |
| Date approximate | Checkbox | Applied on is an upper bound ("on or before") |
| Events | Relation | Two-way with 📈 Application Events |
| Agent runs | Relation | To NOTION_AGENT_RUNS_DB |
| Days since applied | Formula |  |
| Fill time | Formula |  |
| Fresh | Formula |  |
| Interviews | Relation | To NOTION_INTERVIEWS_DB |
| Last update | Last edited time |  |
| Tailored CV | Files |  |
| Rejection reason | Select | Options: `Presentation`, `Hard skills`, `Soft skills`, `Not a fit (not on you)`, `Unclear` |
| Rejection lesson | Text |  |
| Reached via | Select | Options: `Email`, `LinkedIn`, `Phone`, `Other` |
| Kit inputs | Text |  |
| Feedback status | Select | Options: `Not asked`, `Asked for feedback`, `Received feedback`, `Skipped` |
| Employer feedback | Text |  |
| Interview prep | Date | When the interview prep kit was built, with the time (🎤 Interview prep on the page; Focus → Prepare; a review of this job's interview after it marks the kit stale) |
| Contract | Select | Options: `Employee`, `B2B / contractor`, `Employee or B2B`. Filled from an interview review when the call said it (never overwritten) |
| Call facts | Text | Facts an interview revealed, `Label: value · …` (Your ask, Relocation, Team size, Company size, Visa/permit, Start date); a review adds missing ones and never overwrites |
| Origin | Select | Options: `Inbound`, `Outbound`. Who made the first contact: Inbound = a recruiter/lead you logged (Recruiter lead, Gmail pitch, a logged message); Outbound = a job you went after (match, kit, apply, applied elsewhere, saved). Set once when the row is created, never overwritten by the app on its own; only your answer to "Who reached out first?" in Log job activity (a conversation that began before the job's first contact) flips Outbound to Inbound, and the reply and the job's page say so. Change it by hand when it's wrong. Empty (older rows): derived from Source/Stage/Notes/events, and filled once by the app (`python -m src.notion.origin --backfill`) |
| Runs | Relation | Two-way with ⏰ Cronjob Runs "Application": every run about this job (logged activity, kit, interview prep/review, rejection review). An older one-way "Application" is made two-way by the app at connect/start-up; if Notion refuses, the app says: Cronjob Runs → Application column menu → turn on "Show on Job Tracker", name it "Runs" |
| Created | Date | When the record was created in its first store (kept when moved to Notion; else the page's created time). src/stores/notion.py |

The page body gets a "🗂 Application record" toggle section: every question with the answer sent
(and the kit's draft, marked ✏️ when edited), the cover letter, and a JSON block with the job
description, AI facts and scores.

The application kit (📝 Prepare, or auto-drafted) is written as a toggle heading block named
"📝 Application kit" inside each row's page content — that's page content, not a database property,
so it doesn't need a schema entry.

## Job Matches — AI Scored (database)

Env var: `NOTION_MATCHES_DB`. One row per job AI stage 2 has scored; rebuilt from SQLite, safe to
delete and let it repopulate.
**Rule:** Job Matches = what a search found and scored; jobs and recruiter leads you add live on Applications only (`src/ai/added.py`).

| Property | Type | Notes |
|---|---|---|
| Job | Title | |
| Score | Number | 0-100 |
| Tier | Select | Options: `A`, `B`, `C` |
| Company | Text | |
| Location | Text | |
| Reason | Text | One line |
| Strengths | Text | Semicolon-separated |
| Gaps | Text | Semicolon-separated |
| Role fit | Number | 0-100 |
| Location fit | Number | 0-100 |
| Compensation fit | Number | 0-100 |
| Growth | Number | 0-100 |
| Risk | Number | 0-100, higher = more risk/uncertainty |
| Confidence | Select | Options: `high`, `medium`, `low` |
| Job URL | URL | |
| Code | Text | 8-hex job code, e.g. for `/apply_<code>` |
| Status | Select | Options: `Open`, `Applied`, `Dismissed`, `Not seen` (the crawl no longer lists it; not proof it closed) |
| Scored | Date | |
| Seniority | Select | Options: `Junior`, `Mid`, `Senior`, `Staff/Principal`, `Lead/Manager` |
| Work mode | Select | Options: `On-site`, `Hybrid`, `Remote` |
| Languages | Multi-select | e.g. `English`, `German +` (a "+" suffix means "a plus", not required) |
| Salary | Text | |
| Recruiter | Checkbox | |
| Technologies | Text | Key technologies from the posting (stage 1), semicolon-separated |
| Role family | Select | `sre`, `platform`, `devops`, `cloud_infrastructure`, `software`, `data`, `security`, `support_it`, `sales_retail`, `logistics`, `hospitality`, `healthcare`, `creative_media`, `finance_admin`, `education`, `trades`, `other` |
| Workload | Text | e.g. `80-100%`; empty when the posting doesn't say |
| On call | Select | `Yes`, `No` |
| Visa | Select | `Offered`, `Not offered` (only when the posting says so) |
| Remote scope | Text | Where remote work is allowed, as the posting says |
| Contract | Select | `Permanent`, `Fixed term`, `Freelance`, `Internship` |
| Deadline | Date | Application deadline, when the posting states one |
| Posted | Date | When the posting was published |
| Responsibilities | Text | What the role involves: up to 4 short lines, one per line |
| Last update | Last edited time |  |
| First seen | Date |  |
| Scoring method | Select | Options: `Current`, `Previous` |
| Scored with places | Text |  |

## Employers & Sources (database)

Env var: `NOTION_EMPLOYERS_DB`. One row per employer or job board the crawler knows about; the
scout creates and updates these (optional since the central employer index: the crawler downloads that and merges it with
`config/sources.json`, so this database is only your own list). Optional for a first run — the crawler falls back to
the downloaded index, `config/sources.json` and its own local feed table if this database is empty or unset.

| Property | Type | Notes |
|---|---|---|
| Company | Title | |
| Kind | Select | Option used by code: `Employer` |
| Tier | Select | Free text from `config/scout_seeds.json`, e.g. `Tier 1` |
| Feed status | Select | Options: `Feed found`, `Low relevance`, `Manual watch`, `No public feed`, `No open jobs` |
| Active | Checkbox | Whether the crawler includes this feed |
| Origin | Text | Where the candidate came from (seed list, Hacker News, ...) |
| Glassdoor | URL | Auto-filled search link |
| levels.fyi | URL | Auto-filled search link |
| Checked | Date | |
| Quality | Number | 0-100 |
| ATS | Select | Options: the systems in `src/sources/ats.py` (Greenhouse, Lever, Ashby, Workable, Recruitee, Personio, SmartRecruiters, Teamtailor, JOIN, Workday, Haufe Umantis, SAP SuccessFactors, and a company's own careers page) |
| Slug | Text | |
| Feed | URL | |
| Careers | URL | |
| Cities | Text | |
| Relevant roles | Number | |
| In preferred places | Number | |
| Notes | Text | |
| Integration | Select | Option used by code: `Working` |
| Added | Date | |
| Size | Text |  |
| Verification | Select | Options: `Career link found`, `Needs research`, `Location conflict` |
| Website | URL |  |

## 📈 Application Events (database)

Env var: `NOTION_EVENTS_DB`. One row per outcome change of an application; the Applications Stage
holds only the latest. Written by `ledger.mark_applied` (watcher / `--mark-applied`), the Telegram
✅ Applied button, the `/applied` outcome buttons (Worker), and `ledger.sync` on scheduled runs (a
Stage edited by hand in Notion, and the 30-day no-response rule).

One row per real occurrence, enforced when written (`ledger.add_event`): the same Source ID is never written twice, a
stage kind is once per application, and a second `Interview scheduled` only for another interview time. `ledger.sync`
never logs a kind the application already has. An interview time impossible for the message it was read from (over
30 days before it, or over a year after: a pasted chat's year misread) is never stored (`ledger.plausible_interview`);
the app's log step asks "When is the call?" instead. An invitation from the Calendar check that adopts the watcher's
guess ("Notion edit") gives it Source `Calendar` and its own note.

| Property | Type | Notes |
|---|---|---|
| Event | Title | "Kind · Company" |
| Application | Relation | To Job Tracker (two-way, shows there as "Events") |
| Kind | Select | `Applied`, `Reply received` (a human answered; no Stage change), `Replied` (you wrote: Done in Focus, your last message in a logged chat, or your sent Gmail to the job's contact; Focus → Follow up after 3 days without an answer), `Confirmation received`, `Screening`, `Interview scheduled`, `Interviewing`, `Offer`, `Rejected`, `Withdrawn`, `No response`, `Interview cancelled` (you said in Focus the call did not happen; no Stage change) |
| At | Date | With time |
| Source | Select | `Telegram`, `Notion edit`, `Watcher`, `Auto rule`, `CLI`, `Backfill`, `Gmail`, `Calendar` |
| Source ID | Text | Gmail message id, `cal:<event id>`, `paste:<hash>` (a logged message) or `chat:<hash>` (a chat's last message: who + when + first words); never logged twice |
| Note | Text | |
| Job URL | URL | |
| Changes | Text | JSON: what the email changed (before/after per field), its interview time and sender |
| Needs you | Checkbox | The Gmail check wasn't sure which job: Focus asks "Is this about …?" |
| Suggested job | URL | The likeliest job for a Needs-you email (its Job URL) |
| Created | Date | When the event was recorded in its first store (kept when moved to Notion). src/stores/notion.py |

## 🎤 Interviews (database)

Env var: `NOTION_INTERVIEWS_DB`. One row per interview (`src/ai/interviews.py`): sent to the bot, or
saved from the app's Interviews page. The page body holds the analysis (strengths, weak spots, signals,
practice, every question with ✅/➖/⚠️/❌) and the full transcript in a toggle. A transcript saved from
the app without a review has only the transcript (and a "Not reviewed yet" line where the review goes);
its Overall is empty until it's reviewed.

| Property | Type | Notes |
|---|---|---|
| Interview | Title | "Company · Round" |
| Application | Relation | To Job Tracker (two-way, shows there as "Interviews"); empty when unclear |
| Date | Date | |
| Round | Text | e.g. Recruiter screen, Technical 1 |
| Overall | Select | `positive`, `neutral`, `negative` |
| Questions / Weak answers | Number | |
| Topics / Weak topics | Text | Semicolon-separated; the insights count these across interviews |
| Next step | Text | |
| Input | Select | `Recording` (transcribed with speakers by `src/ai/transcribe.py`), `Transcript`, `Notes` |
| Cost (USD) | Number (dollar) | |
| Model | Text | |
| Questions | Number |  |
| Topics | Text |  |
| Weak answers | Number |  |
| Weak topics | Text |  |

## 💡 Insights (database)

Env var: `NOTION_INSIGHTS_DB`. One row per daily insight (`src/ai/insights.py`), created before the
Telegram message so its buttons can point at the row.
Plus one upserted row with Category `Interview patterns` (`src/ai/interview_insights.py`): what the reviewed
interviews show together, rewritten after each review; the app's Interviews page shows it. It is not a daily insight.

| Property | Type | Notes |
|---|---|---|
| Insight | Title | The headline |
| Date | Date | One insight per day; the scheduled run checks this before making another |
| Category | Select | `Skills`, `CV`, `Location`, `Salary`, `Seniority`, `Role focus`, `Timing`, `Activity`, `Process`, `Weekly report`, `Interview patterns`, `Suggestion` (a person's answer to a suggestion that has no row of its own) |
| Basis | Select | `Market`, `Applications`, `Both`, `Interviews` |
| Confidence | Select | `high`, `medium`, `low` |
| Sample size | Number | Jobs or applications behind the finding |
| Evidence | Text | One line per figure |
| Action | Text | |
| Feedback | Select | `Useful`, `Not useful`, `Acting on it` — set by the Telegram buttons; the next insights read it |
| Cost (USD) | Number (dollar) | |
| Model | Text | |
| Issue detected | Checkbox |  |
| Input hash | Text | Interview patterns only: fingerprint of the reviewed interviews it was made from; unchanged = no new AI call |
| Data | Text | Interview patterns: the patterns, cited interviews and to-dos as JSON, for the app. Weekly report: the one button the AI picked (door, label) as JSON |
| Hidden until | Date | A suggestion answered Not now: hidden from Focus, Jobs and its home until this day (14 days) |
| State | Select | Options: `Done`, `Not now`, `Not true`, `Stale`. A person's answer to a suggestion (Focus → Suggestions ⋯); empty = open |

## ⏰ Cronjob Runs (database)

Env var: `NOTION_CRON_RUNS_DB`. One row per scheduled pipeline run (`daily.yml`, modes `scheduled`,
`run`, `today`, only when sending), written by `src/notion/cron_runs.py` at the end of
`daily.main()`. The page body holds the mini-report and per-stage token/cost lines. Costs come from
`src/ai/cost.py` (Haiku 5.5 $0.10/$0.50, Sonnet 5 $2/$10 per million tokens; cache read 0.1x, write 1.25x).

| Property | Type | Notes |
|---|---|---|
| Run | Title | "YYYY-MM-DD HH:MM · Kind · subject" (local time), e.g. "2026-09-30 11:44 · Log activity · Duvo.ai — SRE", "… · Gmail check · 3 updates". Subject set at the end; a running or failed run keeps "date · Kind". Code reads Mode, never this title |
| Started | Date | With time |
| Duration (s) | Number | |
| Mode | Select | `scheduled`, `run`, `today`, `prepare`, `insight`, `weekly`, `interview`, `mail` — every AI job logs a row, so they add up to the month's AI spend (the budget guard sums them) |
| Trigger | Select | `Schedule`, `Manual` (workflow_dispatch / Telegram), `Local` |
| Status | Select | `OK`, `Warnings` (a stage skipped or a feed failed), `Quiet` (nothing new) |
| Feeds / Feed errors | Number | Employer feeds scanned / failed |
| New jobs / Changed jobs | Number | From this crawl |
| Closed stale | Number | Jobs not seen for 7 days |
| Enriched / Scored / Kits / Insights / Interviews / Emails | Number | Done this run per AI stage |
| Top new score | Number | Best fit score among jobs first seen this run |
| Cost enrich / score / kits / insight / interview / mail (USD) | Number | Per stage |
| AI cost (USD) | Number | Total |
| Tokens (total) | Number | In + out + cached, all stages |
| Telegram | Text | Sent / not sent |
| Summary | Text | Report headline |
| Run URL | URL | GitHub Actions run |
| Run id | Text | Joins this row to logs/app.log, logs/engine.log, and `run_id=` in the Actions log |
| Changed jobs | Number |  |
| Cost enrich (USD) | Number |  |
| Cost insight (USD) | Number |  |
| Cost interview (USD) | Number |  |
| Cost kits (USD) | Number |  |
| Cost mail (USD) | Number |  |
| Cost score (USD) | Number |  |
| Emails | Number |  |
| Enriched | Number |  |
| Feed errors | Number |  |
| Feeds | Number |  |
| Insights | Number |  |
| Interviews | Number |  |
| Kits | Number |  |
| New jobs | Number |  |
| Scored | Number |  |
| Application | Relation | To Job Tracker (two-way, shows there as "Runs"): the one job a run was about; empty for runs about many jobs (search, Gmail check, insights) |
| Updates | Number |  |
| Billed to | Select | How the run's AI was paid: `Claude subscription` (the user's own Claude Code on the Mac, $0 API), `Anthropic API credits` (API key), `Both` (plan limit hit, fell back to the key); empty when no AI ran |
| Kind | Select | What ran (search, mail, kit…), as the store names it; an older row has none and its Mode is used. src/stores/notion_cron_runs.py |
| Where | Select | Where it ran (mac, github); an older row has none and Run URL / Trigger tell. |
| Progress | Text | The run's progress lines (the last 40), one per line; Summary shows the latest with ⏳ while it runs. |
| Finished | Date | When the run ended, with time. |

Views: **Latest runs** (newest first), **AI cost per day** (column chart).

## 🤖 Job Apply — Agent Runs (database)

Env var: `NOTION_AGENT_RUNS_DB`. One row per form-filling session, written by
`python3 -m src.ai.apply_run` (Codex runs and `--record` for Claude runs). Optional: runs are still
recorded locally without it. Rows never contain applicant values, only field labels and ✓/CHECK.

| Property | Type | Notes |
|---|---|---|
| Run | Title | "Company · Job · Agent" |
| Job | Relation | To Job Tracker (two-way, shows there as "Agent runs") |
| Job URL | URL | |
| Company | Text | |
| Agent | Select | Options: `Claude`, `Codex`, `ChatGPT`, `Manual` |
| ATS | Select | Options: `Greenhouse`, `Ashby`, `Lever`, `Workable`, `Other` |
| Status | Select | Options: `Ready`, `Needs input`, `Failed` |
| Started | Date | With time |
| Ended | Date | With time |
| Minutes | Number | Active fill time |
| Fields | Number | Visible non-legal fields audited |
| Unfilled required | Number | |
| Reason | Text | Why it isn't Ready |
| Learnings | Text | One-line finding; agents read these before filling (`--learnings`) |
| Billed to | Select | Options: `Claude subscription`, `ChatGPT plan`, `Anthropic API credits`, `Unknown` — form filling doesn't use API credits |
| Tokens (total) | Number | All tokens the session used from start to hand-over (incl. cached context), from its transcript/trace |
| Output tokens | Number | |
| Run ID | ID | Prefix `RUN` |
| Age (days) | Formula |  |
| Fill time | Formula |  |
| Fresh | Formula |  |
| Job stage | Rollup |  |
| Waiting for you | Formula |  |
| Claude working (min) | Number |  |
| Waiting for you (min) | Number |  |
| Times asked | Number |  |
| Your reply (median s) | Number |  |
| Ready → decided (min) | Number |  |
| Outcome | Select | Options: `Submitted`, `Not submitted`, `Open`, `Restarted`, `Cancelled` |
| Turns | Number |  |
| Tool calls | Number |  |
| Tools used | Text |  |
| Tokens in | Number |  |
| Tokens out | Number |  |
| Cache read | Number |  |
| Model | Text |  |
| Session timeline | Text |  |
| Session id | Text | The Apply session's id, so the app and the engine update one row for one session. src/stores/notion_agent_runs.py |
| Data | Text | Anything else the run kept, as JSON (the store's catch-all `data`). |
| Created | Date | When the run was recorded in its first store (kept when moved to Notion; else the page's created time). |

The page body lists per-step timings, each field ✓/CHECK, attachments and the learning.

## Profile — CV and Preferences (page, not a database)

Env var: `NOTION_PROFILE_PAGE_ID`. A single Notion page, read as plain text every scoring run — no
fixed property schema, just headings and content. Recommended sections (see the maintainer's own
page for a worked example, or write your own in whatever structure suits you — the scorer just
reads all the text):

- **Hard constraints** — countries/cities you'll work in, work permit and languages, minimum
  seniority, workload, employment type, recruiter tolerance
- **Compensation** — your target, as a range or a single figure
- **Preferences** — role types, company size, industries, on-call tolerance, leadership scope
- **Summary** — a few sentences from your CV
- **Core skills** — grouped by area
- **Experience** — a table of role, company, dates, highlights

## Application Answers — Standard Form Fields (page, not a database)

Env var: `NOTION_ANSWERS_PAGE_ID`. A single page, kept separate from Profile so editing it doesn't
re-trigger scoring. Read by the kit drafter. Recommended sections:

- **Eligibility** — work authorisation per country/region you apply to, remote-work eligibility
- **Availability and pay** — notice period, salary expectations per currency/region, relocation
- **Links** — LinkedIn, GitHub, website, CV filename
- **Common questions** — "how did you hear about us", demographic-question defaults (e.g. "decline
  to self-identify"), consent-to-keep-data default
- **Cover letter style** — length, tone, what to always/never mention

Mark anything you haven't decided yet with ❓ — the kit drafter treats that as "draft your best
guess and flag it for review," never as a fact to state confidently.
