# Automatic routing of saved Profile lines

The owner rejected technical home-selection questions (27 Oct 2026): the app must organize saved lines itself. PR #2302 first repaired context, exact-copy identity and preservation; this follow-up removes the home-picker burden.

The existing profile-move judge receives source page/heading context and a validated catalogue of actual Profile/Application answers sections plus canonical app sections, including Cover letter style (Writing preferences). On each read after a save, newly saved or edited lines are also judged for placement and clarity; already judged unchanged lines are not moved again. AI stay leaves a correctly placed line alone. It selects a destination; code never infers meaning from applicant keywords or writes new facts. Existing profileUnsure records are rebuilt against live source lines, automatically routed once, and retired only after a verified move or an explicit AI stay verdict. Uncertain/unavailable/invalid AI results retain the original lines and pending metadata, retry quietly, and never become technical questions for the applicant.

Preservation: source identity includes page, section path and exact content. Different answers under one label remain separate. Duplicate copies consolidate only at the same AI-selected destination. Copy/backup precedes writes; target read-back precedes exact-source removal. A changed source cannot be resurrected from a stale AI answer. No live owner data or paid AI is used during development.

## Data ownership

Original facts stay on the active store's Profile/answers pages through openStore; both SQLite and Notion use the same organizer. Reuse existing profileUnsure metadata and an in-memory digest/deadline; no new editable copy or private cache. The catalogue and AI destinations are transient, rebuilt from actual outlines/UI definitions.

## Progress

### 1. Automatic routing and preservation
- [x] Fictional public producer/store tests fail before the fix and pass on both adapters. (proof: desktop/test/profile-auto-routing.test.js)
- [x] Legacy technical queue items disappear because the organizer handles their sources; stale cached home pickers cannot return. (proof: desktop/test/profile-question-context.test.js)
- [x] No facts lost on repeats, same-label values, failed writes, invalid AI, stale sources or restart. (proof: desktop/test/profile-auto-routing.test.js, desktop/test/store-contract.test.js)

### 2. UI and delivery
- [x] Fictional before/after rendering and independent owner-scenario review. (proof: desktop/test/profile-auto-routing.test.js)
- [ ] Focused checks and green PR through ship; owner merges manually.
